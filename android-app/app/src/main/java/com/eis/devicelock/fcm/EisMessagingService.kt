package com.eis.devicelock.fcm

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import com.eis.devicelock.admin.EisDeviceAdminReceiver
import com.eis.devicelock.heartbeat.HeartbeatScheduler
import com.eis.devicelock.lock.LockActivity
import com.eis.devicelock.lock.LockOverlayService
import com.eis.devicelock.lock.LockStateRepository
import com.eis.devicelock.net.CommandPayload
import com.eis.devicelock.net.DeviceHmac
import com.eis.devicelock.util.Secrets
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import timber.log.Timber

/**
 * Receives push commands from the server.
 *
 * Threat model:
 *  - We assume FCM is plaintext / potentially compromised. Therefore
 *    every command is signed with the device_secret (shared at enrollment)
 *    and HMAC-verified here before being applied.
 *  - Replay defence sits on the **server**: each command_id is single use.
 *  - We also store the last command_id and refuse to re-apply it.
 */
class EisMessagingService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        Timber.i("FCM new token (length=${token.length})")
        val secrets = Secrets.get(this)
        secrets.put(Secrets.KEY_FCM_TOKEN, token)
        // If we're already enrolled, push the new token via a heartbeat.
        if (secrets.has(Secrets.KEY_DEVICE_ID)) {
            HeartbeatScheduler.runNow(this)
        }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        Timber.d("FCM data=$data")
        val cmd = CommandPayload.fromMap(data) ?: run {
            Timber.w("FCM dropped — missing command fields")
            return
        }
        if (cmd.type != "command") return

        val secrets = Secrets.get(this)
        val secret = secrets.get(Secrets.KEY_DEVICE_SECRET) ?: run {
            Timber.w("Command received before enrollment; ignoring")
            return
        }

        if (!DeviceHmac.verifyCommand(secret, cmd.commandId, cmd.action, cmd.issuedAt, cmd.hmac)) {
            Timber.e("HMAC verification FAILED for command_id=${cmd.commandId}")
            LockStateRepository(secrets).recordCommandFailure(cmd.commandId)
            HeartbeatScheduler.runNow(this)
            return
        }

        // Idempotency: ignore re-delivery of a previously-applied command.
        val lastId = secrets.get(Secrets.KEY_LAST_COMMAND_ID)
        if (lastId == cmd.commandId && secrets.get(Secrets.KEY_LAST_COMMAND_STATUS) == "applied") {
            Timber.d("Duplicate command_id=${cmd.commandId} — sending ack heartbeat only")
            HeartbeatScheduler.runNow(this)
            return
        }

        when (cmd.action) {
            "lock" -> applyLock(cmd)
            "unlock" -> applyUnlock(cmd)
            "ping" -> {
                Timber.i("Ping received; firing heartbeat")
                HeartbeatScheduler.runNow(this)
            }
            else -> Timber.w("Unknown command action=${cmd.action}")
        }
    }

    // ---- Apply paths ----

    private fun applyLock(cmd: CommandPayload) {
        Timber.i("Applying LOCK command_id=${cmd.commandId}")
        val secrets = Secrets.get(this)
        val repo = LockStateRepository(secrets)

        // 1) Persist state FIRST. If we crash mid-apply, the next boot will
        //    pick this up and put the device back on the lock screen.
        repo.markLocked(cmd.commandId, cmd.lockMessage)

        // 2) Try to launch the Activity. If we can't (e.g. background limits
        //    on some OEMs), fall back to the SYSTEM_ALERT_WINDOW overlay.
        val launched = runCatching {
            val intent = LockActivity.intent(this)
            startActivity(intent)
            true
        }.getOrElse {
            Timber.w(it, "LockActivity launch failed; trying overlay")
            false
        }
        if (!launched) {
            LockOverlayService.start(this)
        }

        // 3) Apply Device Owner enforcement bits.
        applyLockPolicies()

        // 4) Schedule the ack heartbeat (≤10s) per spec section 4.
        HeartbeatScheduler.runNow(this)
    }

    private fun applyUnlock(cmd: CommandPayload) {
        Timber.i("Applying UNLOCK command_id=${cmd.commandId}")
        val secrets = Secrets.get(this)
        val repo = LockStateRepository(secrets)
        repo.markUnlocked(cmd.commandId)

        // Tear down enforcement.
        LockOverlayService.stop(this)
        clearLockPolicies()

        // Tell any visible LockActivity to finish itself.
        sendBroadcast(Intent(LockActivity.ACTION_FINISH_LOCK).setPackage(packageName))

        HeartbeatScheduler.runNow(this)
    }

    private fun applyLockPolicies() {
        val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as? DevicePolicyManager ?: return
        val admin: ComponentName = EisDeviceAdminReceiver.componentName(this)
        if (!dpm.isDeviceOwnerApp(packageName)) {
            Timber.w("Not DO; skipping lock policy")
            return
        }
        runCatching { dpm.setStatusBarDisabled(admin, true) }
        runCatching { dpm.setLockTaskPackages(admin, arrayOf(packageName)) }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            runCatching {
                dpm.setLockTaskFeatures(admin, DevicePolicyManager.LOCK_TASK_FEATURE_NONE)
            }
        }
        // Make LockActivity the persistent Home so Home key does nothing.
        runCatching {
            val home = IntentFilter(Intent.ACTION_MAIN).apply {
                addCategory(Intent.CATEGORY_HOME)
                addCategory(Intent.CATEGORY_DEFAULT)
            }
            dpm.addPersistentPreferredActivity(
                admin,
                home,
                ComponentName(this, "com.eis.devicelock.lock.LockActivity")
            )
        }
    }

    private fun clearLockPolicies() {
        val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as? DevicePolicyManager ?: return
        val admin: ComponentName = EisDeviceAdminReceiver.componentName(this)
        if (!dpm.isDeviceOwnerApp(packageName)) return
        runCatching { dpm.setStatusBarDisabled(admin, false) }
        runCatching { dpm.clearPackagePersistentPreferredActivities(admin, packageName) }
    }

}
