package com.eis.devicelock.heartbeat

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.telephony.TelephonyManager
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.eis.devicelock.lock.LockStateRepository
import com.eis.devicelock.net.ApiClient
import com.eis.devicelock.net.CommandQueue
import com.eis.devicelock.net.HeartbeatRequest
import com.eis.devicelock.util.Secrets
import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import timber.log.Timber

/**
 * Periodic + on-demand heartbeat sender.
 *
 * Flow:
 *  1. Bail out (success) if the device isn't enrolled yet — nothing to send.
 *  2. Collect location, battery, network, SIM ICCID, lock state.
 *  3. Build the [HeartbeatRequest] body matching protocol spec section 5.
 *  4. POST via [ApiClient.heartbeat], which signs the body with HMAC.
 *  5. On failure, queue a serialized copy in [CommandQueue] for the next run.
 */
class HeartbeatWorker(
    appContext: Context,
    params: WorkerParameters
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        val ctx = applicationContext
        val secrets = Secrets.get(ctx)
        if (!secrets.has(Secrets.KEY_DEVICE_ID) || !secrets.has(Secrets.KEY_DEVICE_SECRET)) {
            Timber.d("Heartbeat skipped — not enrolled")
            return Result.success()
        }

        val repo = LockStateRepository(secrets)
        val moshi = Moshi.Builder().add(KotlinJsonAdapterFactory()).build()
        val adapter = moshi.adapter(HeartbeatRequest::class.java)

        val body = buildBody(ctx, secrets, repo)

        return runCatching {
            // Replay any previously-queued bodies first.
            val queue = CommandQueue(ctx)
            val pending = queue.drain()
            val api = ApiClient(secrets)
            for (event in pending) {
                runCatching {
                    val req = adapter.fromJson(event.payloadJson)
                    if (req != null) api.heartbeat(req)
                }.onFailure {
                    Timber.w(it, "Re-replay failed; re-queueing")
                    queue.enqueue(event)
                }
            }

            val resp = api.heartbeat(body)
            if (resp.ok) {
                secrets.putLong(Secrets.KEY_LAST_HEARTBEAT_AT, System.currentTimeMillis())
                Result.success()
            } else {
                Timber.w("Heartbeat rejected: ${resp.error}")
                Result.retry()
            }
        }.getOrElse { t ->
            Timber.w(t, "Heartbeat HTTP failed; queueing")
            CommandQueue(ctx).enqueue(
                CommandQueue.QueuedEvent(
                    kind = "heartbeat",
                    payloadJson = adapter.toJson(body),
                    createdAt = System.currentTimeMillis()
                )
            )
            Result.retry()
        }
    }

    private suspend fun buildBody(
        ctx: Context,
        secrets: Secrets,
        repo: LockStateRepository
    ): HeartbeatRequest {
        val location = LocationProvider(ctx).fetchCurrent()
        val battery = batteryPct(ctx)
        val network = networkType(ctx)
        val sim = simIccid(ctx)
        return HeartbeatRequest(
            imei = secrets.get(Secrets.KEY_IMEI).orEmpty(),
            lock_state = if (repo.isLocked()) Secrets.LOCK_STATE_LOCKED else Secrets.LOCK_STATE_UNLOCKED,
            last_command_id = repo.lastCommandId(),
            last_command_status = repo.lastCommandStatus(),
            battery_pct = battery,
            network_type = network,
            sim_serial = sim,
            lat = location?.latitude,
            lon = location?.longitude,
            accuracy_m = location?.accuracy?.toInt(),
            fcm_token = secrets.get(Secrets.KEY_FCM_TOKEN)
        )
    }

    private fun batteryPct(ctx: Context): Int {
        val bm = ctx.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager
        bm?.let { return it.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY) }
        // Pre-Lollipop fallback (not actually hit given minSdk=26).
        val filter = IntentFilter(Intent.ACTION_BATTERY_CHANGED)
        val sticky = ctx.registerReceiver(null, filter)
        val level = sticky?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = sticky?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
        return if (level >= 0 && scale > 0) (level * 100 / scale) else 0
    }

    private fun networkType(ctx: Context): String {
        val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            ?: return "none"
        val active = cm.activeNetwork ?: return "none"
        val caps = cm.getNetworkCapabilities(active) ?: return "none"
        return when {
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "mobile"
            else -> "none"
        }
    }

    private fun simIccid(ctx: Context): String? {
        return runCatching {
            val tm = ctx.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
            @Suppress("DEPRECATION", "HardwareIds")
            tm?.simSerialNumber
        }.getOrNull()
    }
}
