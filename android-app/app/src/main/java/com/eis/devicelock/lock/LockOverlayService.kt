package com.eis.devicelock.lock

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.os.Build
import android.os.IBinder
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.app.NotificationCompat
import com.eis.devicelock.EisDeviceLockApp
import com.eis.devicelock.R
import timber.log.Timber

/**
 * Fallback enforcement path.
 *
 * Most of the time [LockActivity] (plus the Home intent filter) is enough
 * to keep the customer on the lock screen. But on a handful of OEM ROMs the
 * Activity can be momentarily hidden — e.g. when the user pulls down a
 * notification panel before our setStatusBarDisabled lands. This service
 * draws an unkillable SYSTEM_ALERT_WINDOW overlay as a belt-and-braces.
 *
 * Requires SYSTEM_ALERT_WINDOW. As a Device Owner we can grant ourselves
 * this at enrollment time on most OEMs.
 */
class LockOverlayService : Service() {

    private var overlay: View? = null
    private var wm: WindowManager? = null

    override fun onCreate() {
        super.onCreate()
        wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        startForeground(NOTIF_ID, buildNotification())
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!canDrawOverlays()) {
            Timber.w("LockOverlayService started but overlay permission is missing")
            stopSelf()
            return START_NOT_STICKY
        }
        if (overlay == null) addOverlay()
        return START_STICKY
    }

    private fun canDrawOverlays(): Boolean =
        Settings.canDrawOverlays(this)

    private fun addOverlay() {
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_SYSTEM_ALERT
        }
        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            type,
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD,
            PixelFormat.OPAQUE
        ).apply {
            gravity = Gravity.CENTER
        }

        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#0B1220"))
            gravity = Gravity.CENTER
            addView(TextView(this@LockOverlayService).apply {
                text = getString(R.string.lock_title)
                setTextColor(Color.WHITE)
                textSize = 28f
                gravity = Gravity.CENTER
            })
            addView(TextView(this@LockOverlayService).apply {
                text = getString(R.string.lock_default_message)
                setTextColor(Color.parseColor("#E2E8F0"))
                textSize = 18f
                gravity = Gravity.CENTER
            })
        }
        runCatching { wm?.addView(container, params) }
            .onFailure { Timber.e(it, "Failed to addView overlay") }
        overlay = container
    }

    private fun buildNotification(): Notification {
        val pi = PendingIntent.getActivity(
            this, 0,
            LockActivity.intent(this),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        return NotificationCompat.Builder(this, EisDeviceLockApp.CHANNEL_LOCK)
            .setContentTitle(getString(R.string.notif_lock_title))
            .setContentText(getString(R.string.notif_lock_text))
            .setSmallIcon(R.drawable.ic_lock)
            .setOngoing(true)
            .setContentIntent(pi)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .build()
    }

    override fun onDestroy() {
        overlay?.let { runCatching { wm?.removeView(it) } }
        overlay = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        private const val NOTIF_ID = 4711

        fun start(context: Context) {
            val i = Intent(context, LockOverlayService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(i)
            } else {
                context.startService(i)
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, LockOverlayService::class.java))
        }
    }
}
