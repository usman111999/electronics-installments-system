package com.eis.devicelock.admin

import android.app.admin.DeviceAdminReceiver
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.UserManager
import timber.log.Timber

/**
 * DeviceAdminReceiver — also acts as our Device-Owner component.
 *
 * Wired up in AndroidManifest.xml with [android.app.action.DEVICE_ADMIN_ENABLED].
 * Once the Android setup wizard runs Device-Owner provisioning, this class
 * is granted policy-controller status and we can apply restrictions.
 */
class EisDeviceAdminReceiver : DeviceAdminReceiver() {

    override fun onEnabled(context: Context, intent: Intent) {
        super.onEnabled(context, intent)
        Timber.i("Device admin enabled")
    }

    override fun onDisabled(context: Context, intent: Intent) {
        super.onDisabled(context, intent)
        Timber.w("Device admin disabled — lock enforcement compromised")
    }

    override fun onProfileProvisioningComplete(context: Context, intent: Intent) {
        super.onProfileProvisioningComplete(context, intent)
        Timber.i("Profile provisioning complete (managed profile path)")
    }

    companion object {
        fun componentName(context: Context): ComponentName =
            ComponentName(context, EisDeviceAdminReceiver::class.java)

        /**
         * Apply baseline restrictions appropriate for an instalment-financed
         * customer device. Idempotent — safe to call multiple times.
         *
         * Call once at enrollment success and again on boot if we detect
         * the policies have drifted.
         */
        @Suppress("LongMethod")
        fun applyBaselineRestrictions(context: Context) {
            val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as? DevicePolicyManager
                ?: return
            val admin = componentName(context)
            if (!dpm.isDeviceOwnerApp(context.packageName)) {
                Timber.w("Not Device Owner; cannot apply restrictions")
                return
            }
            runCatching { dpm.setUninstallBlocked(admin, context.packageName, true) }
                .onFailure { Timber.w(it, "setUninstallBlocked failed") }

            val restrictions = listOf(
                UserManager.DISALLOW_FACTORY_RESET,
                UserManager.DISALLOW_ADD_USER,
                UserManager.DISALLOW_REMOVE_USER,
                UserManager.DISALLOW_DEBUGGING_FEATURES,
                UserManager.DISALLOW_INSTALL_UNKNOWN_SOURCES,
                UserManager.DISALLOW_SAFE_BOOT,
                UserManager.DISALLOW_OUTGOING_BEAM,
                UserManager.DISALLOW_MODIFY_ACCOUNTS,
                UserManager.DISALLOW_CONFIG_WIFI,
            )
            for (r in restrictions) {
                runCatching { dpm.addUserRestriction(admin, r) }
                    .onFailure { Timber.w(it, "addUserRestriction($r) failed") }
            }

            // Allow ourselves into the lock-task allowlist; LockActivity uses startLockTask().
            runCatching {
                dpm.setLockTaskPackages(admin, arrayOf(context.packageName))
            }.onFailure { Timber.w(it, "setLockTaskPackages failed") }
        }
    }
}
