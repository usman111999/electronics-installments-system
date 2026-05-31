package com.eis.devicelock.boot

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.eis.devicelock.admin.EisDeviceAdminReceiver
import com.eis.devicelock.heartbeat.HeartbeatScheduler
import com.eis.devicelock.lock.LockActivity
import com.eis.devicelock.lock.LockStateRepository
import timber.log.Timber

/**
 * Re-applies the lock state at boot.
 *
 * Triggered by BOOT_COMPLETED + LOCKED_BOOT_COMPLETED so we run even if
 * the device is encrypted-but-not-unlocked. Also re-arms the heartbeat
 * worker because PeriodicWorkRequest schedules survive reboot on most
 * OEMs but not all.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        Timber.i("BootReceiver got ${intent.action}")
        // Re-assert Device Owner restrictions if we have them.
        EisDeviceAdminReceiver.applyBaselineRestrictions(context)

        // Re-launch lock if we were locked.
        val repo = LockStateRepository.from(context)
        if (repo.isLocked()) {
            Timber.i("Boot: lock_state=locked → launching LockActivity")
            context.startActivity(LockActivity.intent(context))
        }

        // Re-schedule heartbeat regardless of state.
        HeartbeatScheduler.schedulePeriodic(context)
        HeartbeatScheduler.runNow(context)
    }
}
