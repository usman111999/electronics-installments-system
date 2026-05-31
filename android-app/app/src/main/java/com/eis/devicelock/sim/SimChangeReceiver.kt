package com.eis.devicelock.sim

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.telephony.TelephonyManager
import com.eis.devicelock.heartbeat.HeartbeatScheduler
import com.eis.devicelock.util.Secrets
import timber.log.Timber

/**
 * Watches for SIM hot-swap events.
 *
 * If the new ICCID differs from the one we recorded at last heartbeat,
 * fire an immediate heartbeat. The backend uses that to emit a
 * `sim_change` activity entry and ping WhatsApp to the branch operator.
 */
class SimChangeReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        Timber.d("SimChangeReceiver action=$action")
        val tm = context.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
        val newIccid = runCatching {
            @Suppress("DEPRECATION", "HardwareIds")
            tm?.simSerialNumber
        }.getOrNull()
        val secrets = Secrets.get(context)
        val oldIccid = secrets.get(Secrets.KEY_LAST_SIM_ICCID)
        if (newIccid != null && newIccid != oldIccid) {
            Timber.i("SIM ICCID changed; old=${oldIccid ?: "<none>"} new=$newIccid — firing heartbeat")
            secrets.put(Secrets.KEY_LAST_SIM_ICCID, newIccid)
            HeartbeatScheduler.runNow(context)
        }
    }
}
