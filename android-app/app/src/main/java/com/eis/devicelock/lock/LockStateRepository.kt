package com.eis.devicelock.lock

import android.content.Context
import com.eis.devicelock.util.Secrets

/**
 * Single source of truth for the device's lock state.
 *
 * Reads/writes go to [Secrets] (EncryptedSharedPreferences) so the state
 * survives reboot. [BootReceiver] uses [isLocked] on `BOOT_COMPLETED` to
 * decide whether to launch [LockActivity] again.
 *
 * IMPORTANT: persist BEFORE applying UI changes so a mid-apply crash
 * leaves a self-consistent record.
 */
class LockStateRepository(private val secrets: Secrets) {

    fun isLocked(): Boolean =
        secrets.get(Secrets.KEY_LOCK_STATE) == Secrets.LOCK_STATE_LOCKED

    fun markLocked(commandId: String?, lockMessage: String?) {
        secrets.put(Secrets.KEY_LOCK_STATE, Secrets.LOCK_STATE_LOCKED)
        if (commandId != null) secrets.put(Secrets.KEY_LAST_COMMAND_ID, commandId)
        secrets.put(Secrets.KEY_LAST_COMMAND_STATUS, "applied")
        if (lockMessage != null) secrets.put(Secrets.KEY_LOCK_MESSAGE, lockMessage)
    }

    fun markUnlocked(commandId: String?) {
        secrets.put(Secrets.KEY_LOCK_STATE, Secrets.LOCK_STATE_UNLOCKED)
        if (commandId != null) secrets.put(Secrets.KEY_LAST_COMMAND_ID, commandId)
        secrets.put(Secrets.KEY_LAST_COMMAND_STATUS, "applied")
    }

    fun recordCommandFailure(commandId: String?) {
        if (commandId != null) secrets.put(Secrets.KEY_LAST_COMMAND_ID, commandId)
        secrets.put(Secrets.KEY_LAST_COMMAND_STATUS, "failed")
    }

    fun recordUnlockAttempt() {
        secrets.putLong(Secrets.KEY_LAST_UNLOCK_ATTEMPT_AT, System.currentTimeMillis())
    }

    fun lastUnlockAttemptAt(): Long = secrets.getLong(Secrets.KEY_LAST_UNLOCK_ATTEMPT_AT, 0L)
    fun lastCommandId(): String? = secrets.get(Secrets.KEY_LAST_COMMAND_ID)
    fun lastCommandStatus(): String? = secrets.get(Secrets.KEY_LAST_COMMAND_STATUS)
    fun lockMessage(): String? = secrets.get(Secrets.KEY_LOCK_MESSAGE)
    fun branchPhone(): String? = secrets.get(Secrets.KEY_BRANCH_PHONE)

    companion object {
        fun from(context: Context): LockStateRepository =
            LockStateRepository(Secrets.get(context))
    }
}
