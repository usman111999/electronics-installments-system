package com.eis.devicelock.enroll

import android.Manifest
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.telephony.TelephonyManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.lifecycleScope
import com.eis.devicelock.R
import com.eis.devicelock.admin.EisDeviceAdminReceiver
import com.eis.devicelock.heartbeat.HeartbeatScheduler
import com.eis.devicelock.net.ApiClient
import com.eis.devicelock.net.EnrollRequest
import com.eis.devicelock.ui.MainActivity
import com.eis.devicelock.util.Secrets
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import timber.log.Timber

/**
 * Drives the post-provisioning enrollment HTTP call.
 *
 * Order of operations:
 *  1. (Device Owner only) grant ourselves READ_PRIVILEGED_PHONE_STATE so
 *     we can read IMEI on API 29+.
 *  2. Fetch IMEI, FCM token.
 *  3. POST to `<url>` with the token from QR.
 *  4. On success: persist device_id, apply baseline restrictions, set
 *     ourselves as the persistent Home if locked, schedule heartbeat,
 *     and route to [MainActivity].
 */
class EnrollActivity : ComponentActivity() {

    private val state: MutableStateFlow<UiState> = MutableStateFlow(UiState.Working("…"))
    val uiState: StateFlow<UiState> = state.asStateFlow()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { MaterialTheme { EnrollUi(uiState) } }
        runEnrollment()
    }

    private fun runEnrollment() {
        lifecycleScope.launch {
            try {
                state.value = UiState.Working(getString(R.string.enroll_in_progress))
                grantSelfPermissions()
                val secrets = Secrets.get(this@EnrollActivity)
                val token = secrets.get(Secrets.KEY_ENROLLMENT_TOKEN)
                    ?: error("Missing enrollment_token; was the QR scanned correctly?")
                val url = secrets.get(Secrets.KEY_ENROLLMENT_URL)
                    ?: error("Missing enrollment URL")
                val imei = readImei() ?: ""
                val fcm = withContext(Dispatchers.IO) {
                    FirebaseMessaging.getInstance().token.await()
                }
                secrets.put(Secrets.KEY_IMEI, imei)
                secrets.put(Secrets.KEY_FCM_TOKEN, fcm)

                val body = EnrollRequest(
                    token = token,
                    imei = imei,
                    fcm_token = fcm,
                    device_model = "${Build.MANUFACTURER} ${Build.MODEL}",
                    android_version = Build.VERSION.RELEASE
                )
                val resp = withContext(Dispatchers.IO) { ApiClient(secrets).enroll(url, body) }
                if (!resp.ok || resp.device_id.isNullOrBlank()) {
                    throw RuntimeException(resp.error ?: "Server rejected enrollment")
                }
                secrets.put(Secrets.KEY_DEVICE_ID, resp.device_id)
                resp.branch_phone?.let { secrets.put(Secrets.KEY_BRANCH_PHONE, it) }

                // Burn the single-use enrollment token from disk.
                secrets.remove(Secrets.KEY_ENROLLMENT_TOKEN)

                EisDeviceAdminReceiver.applyBaselineRestrictions(this@EnrollActivity)
                makeLockActivityHome()

                HeartbeatScheduler.schedulePeriodic(this@EnrollActivity)
                HeartbeatScheduler.runNow(this@EnrollActivity)

                state.value = UiState.Success
                startActivity(
                    Intent(this@EnrollActivity, MainActivity::class.java)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
                )
                finish()
            } catch (t: Throwable) {
                Timber.e(t, "Enrollment failed")
                state.value = UiState.Failed(t.message ?: "unknown")
            }
        }
    }

    /**
     * As a Device Owner we can silently grant ourselves runtime permissions
     * including the protected READ_PRIVILEGED_PHONE_STATE needed for IMEI
     * on API 29+.
     */
    private fun grantSelfPermissions() {
        val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as? DevicePolicyManager
            ?: return
        val admin = EisDeviceAdminReceiver.componentName(this)
        if (!dpm.isDeviceOwnerApp(packageName)) {
            Timber.w("Not Device Owner — skipping self-permission grants")
            return
        }
        val perms = listOf(
            Manifest.permission.READ_PHONE_STATE,
            "android.permission.READ_PRIVILEGED_PHONE_STATE",
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION,
            Manifest.permission.ACCESS_BACKGROUND_LOCATION,
            "android.permission.POST_NOTIFICATIONS"
        )
        for (p in perms) {
            runCatching {
                dpm.setPermissionGrantState(
                    admin, packageName, p,
                    DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED
                )
            }.onFailure { Timber.w(it, "setPermissionGrantState($p) failed") }
        }
    }

    @Suppress("DEPRECATION", "HardwareIds")
    private fun readImei(): String? {
        val tm = getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager ?: return null
        // Order matters: try the newer getImei() first, fall back to getDeviceId()
        // on older API levels. Both require READ_PRIVILEGED_PHONE_STATE on API 29+.
        return runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) tm.imei else tm.deviceId
        }.getOrElse {
            Timber.w(it, "IMEI read failed; trying deviceId")
            runCatching { tm.deviceId }.getOrNull()
        }
    }

    private fun makeLockActivityHome() {
        // Persistent preferred Home is only meaningful while we actively want
        // to take over the launcher. At enrollment time we are NOT locking the
        // device (state is unlocked); the FCM lock handler installs the Home
        // filter when it locks. This method is left here as a no-op hook for
        // future on-enroll-and-immediately-lock flows.
    }

    sealed interface UiState {
        data class Working(val message: String) : UiState
        data object Success : UiState
        data class Failed(val message: String) : UiState
    }
}

@Composable
private fun EnrollUi(stateFlow: StateFlow<EnrollActivity.UiState>) {
    val state by stateFlow.collectAsState()
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        when (val s = state) {
            is EnrollActivity.UiState.Working -> {
                CircularProgressIndicator()
                Text(s.message, modifier = Modifier.padding(top = 16.dp))
            }
            EnrollActivity.UiState.Success -> Text("OK")
            is EnrollActivity.UiState.Failed -> {
                Text("Enrollment failed", style = MaterialTheme.typography.titleLarge)
                Text(s.message, modifier = Modifier.padding(top = 8.dp))
            }
        }
    }
}
