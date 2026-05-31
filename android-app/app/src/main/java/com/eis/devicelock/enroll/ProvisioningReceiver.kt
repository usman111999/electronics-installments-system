package com.eis.devicelock.enroll

import android.app.admin.DevicePolicyManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.eis.devicelock.util.Secrets
import timber.log.Timber

/**
 * Receives the `ACTION_PROVISIONING_SUCCESSFUL` broadcast that the system
 * sends after Device Owner provisioning completes.
 *
 * We:
 *  1. Pull the operator-supplied enrollment payload out of
 *     [DevicePolicyManager.EXTRA_PROVISIONING_ADMIN_EXTRAS_BUNDLE].
 *  2. Stash the values in EncryptedSharedPreferences so [EnrollActivity]
 *     can read them even if the user backgrounds the app first.
 *  3. Launch [EnrollActivity] which actually POSTs to the server.
 */
class ProvisioningReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        Timber.i("ProvisioningReceiver action=${intent.action}")
        val bundle = intent.getBundleExtra(
            DevicePolicyManager.EXTRA_PROVISIONING_ADMIN_EXTRAS_BUNDLE
        )
        val secrets = Secrets.get(context)
        bundle?.let {
            it.getString("token")?.let { v -> secrets.put(Secrets.KEY_ENROLLMENT_TOKEN, v) }
            it.getString("secret")?.let { v -> secrets.put(Secrets.KEY_DEVICE_SECRET, v) }
            it.getString("url")?.let { v ->
                secrets.put(Secrets.KEY_ENROLLMENT_URL, v)
                secrets.put(Secrets.KEY_API_BASE_URL, baseUrlFromEnrollUrl(v))
            }
            it.getString("branch")?.let { v -> secrets.put(Secrets.KEY_BRANCH_ID, v) }
            it.getString("order")?.let { v -> secrets.put(Secrets.KEY_ORDER_ID, v) }
            it.getString("branchPhone")?.let { v -> secrets.put(Secrets.KEY_BRANCH_PHONE, v) }
        }

        val launch = Intent(context, EnrollActivity::class.java)
            .setAction("com.eis.devicelock.ENROLL")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(launch)
    }

    private fun baseUrlFromEnrollUrl(enrollUrl: String): String {
        // Trim the trailing /api/devices/enroll segment if present so the
        // heartbeat path can be appended cleanly later.
        val marker = "/api/devices/enroll"
        return if (enrollUrl.endsWith(marker)) enrollUrl.removeSuffix(marker) else enrollUrl
    }
}
