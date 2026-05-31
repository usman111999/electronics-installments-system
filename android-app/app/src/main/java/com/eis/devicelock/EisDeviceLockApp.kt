package com.eis.devicelock

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import androidx.work.Configuration
import com.eis.devicelock.util.Logger
import timber.log.Timber

/**
 * Application class for the EIS Device Lock app.
 *
 * Responsibilities:
 *  - Wire up Timber for structured logging.
 *  - Register the foreground-service notification channels we need
 *    so the OS does not silently drop our lock notifications.
 *  - Provide a [Configuration.Provider] for WorkManager so [HeartbeatWorker]
 *    is wired with the same logging.
 */
class EisDeviceLockApp : Application(), Configuration.Provider {

    override fun onCreate() {
        super.onCreate()
        Logger.init(this)
        Timber.i("EisDeviceLockApp onCreate")
        createNotificationChannels()
    }

    private fun createNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = getSystemService(NotificationManager::class.java) ?: return
        nm.createNotificationChannel(
            NotificationChannel(
                CHANNEL_LOCK,
                getString(R.string.notif_channel_lock),
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = getString(R.string.notif_channel_lock_desc)
                setShowBadge(false)
            }
        )
        nm.createNotificationChannel(
            NotificationChannel(
                CHANNEL_STATUS,
                getString(R.string.notif_channel_status),
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = getString(R.string.notif_channel_status_desc)
                setShowBadge(false)
            }
        )
    }

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder()
            .setMinimumLoggingLevel(android.util.Log.INFO)
            .build()

    companion object {
        const val CHANNEL_LOCK = "eis_device_lock"
        const val CHANNEL_STATUS = "eis_device_status"
    }
}
