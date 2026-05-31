package com.eis.devicelock.heartbeat

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

/**
 * Scheduling entrypoints for HeartbeatWorker.
 *
 * Keep this object the only place that talks to WorkManager so we have
 * a single tag and a single unique name in case we want to inspect the
 * queue with `adb shell dumpsys jobscheduler` in the field.
 */
object HeartbeatScheduler {

    private const val PERIODIC_NAME = "eis_heartbeat_periodic"
    private const val ONE_SHOT_NAME = "eis_heartbeat_oneshot"

    fun schedulePeriodic(context: Context) {
        val req = PeriodicWorkRequestBuilder<HeartbeatWorker>(30, TimeUnit.MINUTES)
            .setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build()
            )
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            PERIODIC_NAME,
            ExistingPeriodicWorkPolicy.UPDATE,
            req
        )
    }

    /** Fire a one-time heartbeat ASAP. Used after enroll, command-ack, boot, SIM change. */
    fun runNow(context: Context) {
        val req = OneTimeWorkRequestBuilder<HeartbeatWorker>()
            .setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build()
            )
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(
            ONE_SHOT_NAME,
            ExistingWorkPolicy.REPLACE,
            req
        )
    }

    fun cancel(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork(PERIODIC_NAME)
    }
}
