package com.eis.devicelock.lock

import android.app.admin.DevicePolicyManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.KeyEvent
import android.view.WindowManager
import androidx.core.content.ContextCompat
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.eis.devicelock.R
import com.eis.devicelock.admin.EisDeviceAdminReceiver
import com.eis.devicelock.heartbeat.HeartbeatScheduler
import timber.log.Timber

/**
 * Full-screen un-dismissable lock.
 *
 * Sticky behaviour comes from a combination of:
 *  - Window flags + showWhenLocked/turnScreenOn
 *  - startLockTask() (only effective when our package is in the
 *    Device-Owner lock-task allowlist, configured at enrollment)
 *  - Home intent filter registered on this activity so Home key returns here
 *  - DevicePolicyManager.setStatusBarDisabled(true) while locked
 *  - Overriding back/home key events and onUserLeaveHint
 *
 * Customer escape hatches that we deliberately keep working:
 *  - "Emergency call" button → dialer with the local emergency number
 *  - "Call branch" button → dialer with the branch number from enrollment
 */
class LockActivity : ComponentActivity() {

    private val repo by lazy { LockStateRepository.from(this) }

    private val finishReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action == ACTION_FINISH_LOCK) {
                Timber.i("LockActivity: received ACTION_FINISH_LOCK")
                runCatching { stopLockTask() }
                finish()
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        applyWindowFlags()
        ContextCompat.registerReceiver(
            this,
            finishReceiver,
            IntentFilter(ACTION_FINISH_LOCK),
            ContextCompat.RECEIVER_NOT_EXPORTED
        )

        // Belt-and-braces — keep status bar disabled while LockActivity exists.
        runCatching { dpm()?.setStatusBarDisabled(EisDeviceAdminReceiver.componentName(this), true) }
            .onFailure { Timber.w(it, "setStatusBarDisabled(true) failed") }

        // Lock-task mode (only effective if we're whitelisted, which Device Owner is).
        runCatching { startLockTask() }
            .onFailure { Timber.w(it, "startLockTask failed (not Device Owner?)") }

        // Restrict lock-task feature set so notifications, recents, status bar are blocked.
        // Note: setLockTaskFeatures is API 28+. On 26/27 the lock-task default already hides
        // navigation; we just skip the API call.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            runCatching {
                dpm()?.setLockTaskFeatures(
                    EisDeviceAdminReceiver.componentName(this),
                    DevicePolicyManager.LOCK_TASK_FEATURE_NONE
                )
            }.onFailure { Timber.w(it, "setLockTaskFeatures failed") }
        }

        setContent {
            MaterialTheme {
                LockScreenUi(
                    message = repo.lockMessage() ?: getString(R.string.lock_default_message),
                    branchPhone = repo.branchPhone(),
                    lastAttempt = repo.lastUnlockAttemptAt(),
                    onCallBranch = ::callBranch,
                    onEmergency = ::emergencyDial,
                    onUnlockAttempt = {
                        // Customer pressed the Pay-help button — log it so the server
                        // sees engagement in the next heartbeat.
                        repo.recordUnlockAttempt()
                        HeartbeatScheduler.runNow(applicationContext)
                    }
                )
            }
        }
    }

    private fun applyWindowFlags() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        }
        @Suppress("DEPRECATION")
        window.addFlags(
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
                WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD or
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
        )
    }

    private fun dpm(): DevicePolicyManager? =
        getSystemService(Context.DEVICE_POLICY_SERVICE) as? DevicePolicyManager

    private fun callBranch() {
        val phone = repo.branchPhone() ?: return
        startActivity(
            Intent(Intent.ACTION_DIAL, Uri.parse("tel:$phone"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
    }

    private fun emergencyDial() {
        // Emergency calls are allowed even from locked devices; Phone app
        // handles which numbers route through emergency routing.
        startActivity(
            Intent(Intent.ACTION_DIAL, Uri.parse("tel:115"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
    }

    // ----- Anti-bypass overrides -----

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        // Swallow back button.
    }

    override fun onUserLeaveHint() {
        // User hit Home/Recents — re-bring ourselves to the front.
        super.onUserLeaveHint()
        Timber.d("onUserLeaveHint: re-launching LockActivity")
        startActivity(intent(this))
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        return when (keyCode) {
            KeyEvent.KEYCODE_BACK,
            KeyEvent.KEYCODE_HOME,
            KeyEvent.KEYCODE_APP_SWITCH,
            KeyEvent.KEYCODE_MENU -> true // swallow
            else -> super.onKeyDown(keyCode, event)
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) applyWindowFlags()
    }

    override fun onPause() {
        super.onPause()
        // If we're still in lock state, immediately come back.
        if (repo.isLocked()) {
            startActivity(intent(this))
        }
    }

    override fun onDestroy() {
        runCatching { unregisterReceiver(finishReceiver) }
        super.onDestroy()
    }

    companion object {
        const val ACTION_FINISH_LOCK = "com.eis.devicelock.ACTION_FINISH_LOCK"

        fun intent(ctx: Context): Intent =
            Intent(ctx, LockActivity::class.java)
                .setAction("com.eis.devicelock.LOCK")
                .addFlags(
                    Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_CLEAR_TASK or
                        Intent.FLAG_ACTIVITY_NO_USER_ACTION
                )
    }
}

@Composable
private fun LockScreenUi(
    message: String,
    branchPhone: String?,
    lastAttempt: Long,
    onCallBranch: () -> Unit,
    onEmergency: () -> Unit,
    onUnlockAttempt: () -> Unit,
) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val attemptLabel: String = if (lastAttempt == 0L) {
        ctx.getString(R.string.lock_last_attempt, ctx.getString(R.string.lock_never))
    } else {
        val mins = ((System.currentTimeMillis() - lastAttempt) / 60_000L).toInt().coerceAtLeast(0)
        ctx.getString(R.string.lock_last_attempt, ctx.getString(R.string.lock_minutes_ago, mins))
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF0B1220)),
        contentAlignment = Alignment.Center
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 28.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Icon(
                Icons.Filled.Lock,
                contentDescription = null,
                tint = Color(0xFFF59E0B),
                modifier = Modifier.size(120.dp)
            )
            Spacer(Modifier.height(24.dp))
            Text(
                ctx.getString(R.string.lock_title),
                color = Color.White,
                fontSize = 28.sp,
                fontWeight = FontWeight.Bold
            )
            Spacer(Modifier.height(12.dp))
            Text(
                message,
                color = Color(0xFFE2E8F0),
                fontSize = 18.sp
            )
            Spacer(Modifier.height(8.dp))
            Text(
                attemptLabel,
                color = Color(0xFF94A3B8),
                fontSize = 14.sp
            )
            Spacer(Modifier.height(36.dp))

            if (!branchPhone.isNullOrBlank()) {
                Button(
                    onClick = { onUnlockAttempt(); onCallBranch() },
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFF59E0B)),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Icon(Icons.Filled.Phone, contentDescription = null)
                    Spacer(Modifier.size(8.dp))
                    Text(ctx.getString(R.string.lock_call_branch) + "  $branchPhone")
                }
                Spacer(Modifier.height(12.dp))
            }

            OutlinedButton(
                onClick = onEmergency,
                modifier = Modifier.fillMaxWidth()
            ) {
                Icon(Icons.Filled.Call, contentDescription = null, tint = Color.White)
                Spacer(Modifier.size(8.dp))
                Text(ctx.getString(R.string.lock_emergency_call), color = Color.White)
            }
        }
    }
}
