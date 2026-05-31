package com.eis.devicelock.util

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * EncryptedSharedPreferences wrapper. All device secrets, the device_id,
 * lock_state and the last-seen SIM ICCID live here.
 *
 * Backed by Android Keystore (AES-256-GCM). Safe across reboots; not safe
 * if the device is rooted and the attacker can dump /data — but a rooted
 * customer device is already game-over for our use case.
 */
class Secrets private constructor(private val prefs: SharedPreferences) {

    fun put(key: String, value: String) { prefs.edit().putString(key, value).apply() }
    fun get(key: String, default: String? = null): String? = prefs.getString(key, default)
    fun has(key: String): Boolean = prefs.contains(key)
    fun remove(key: String) { prefs.edit().remove(key).apply() }
    fun putLong(key: String, v: Long) { prefs.edit().putLong(key, v).apply() }
    fun getLong(key: String, default: Long = 0L): Long = prefs.getLong(key, default)

    /** Inner accessor for tests. */
    internal fun underlying(): SharedPreferences = prefs

    companion object {
        const val KEY_DEVICE_ID = "device_id"
        const val KEY_DEVICE_SECRET = "device_secret"
        const val KEY_ENROLLMENT_TOKEN = "enrollment_token"
        const val KEY_ENROLLMENT_URL = "enrollment_url"
        const val KEY_API_BASE_URL = "api_base_url"
        const val KEY_BRANCH_ID = "branch_id"
        const val KEY_ORDER_ID = "order_id"
        const val KEY_BRANCH_PHONE = "branch_phone"
        const val KEY_IMEI = "imei"
        const val KEY_FCM_TOKEN = "fcm_token"
        const val KEY_LOCK_STATE = "lock_state"
        const val KEY_LOCK_MESSAGE = "lock_message"
        const val KEY_LAST_COMMAND_ID = "last_command_id"
        const val KEY_LAST_COMMAND_STATUS = "last_command_status"
        const val KEY_LAST_HEARTBEAT_AT = "last_heartbeat_at"
        const val KEY_LAST_UNLOCK_ATTEMPT_AT = "last_unlock_attempt_at"
        const val KEY_LAST_SIM_ICCID = "last_sim_iccid"

        const val LOCK_STATE_LOCKED = "locked"
        const val LOCK_STATE_UNLOCKED = "unlocked"

        @Volatile private var INSTANCE: Secrets? = null

        fun get(context: Context): Secrets {
            INSTANCE?.let { return it }
            synchronized(this) {
                INSTANCE?.let { return it }
                val masterKey = MasterKey.Builder(context.applicationContext)
                    .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                    .build()
                val prefs = EncryptedSharedPreferences.create(
                    context.applicationContext,
                    "eis_secrets",
                    masterKey,
                    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
                )
                val s = Secrets(prefs)
                INSTANCE = s
                return s
            }
        }

        /** Test-only constructor that takes an injected SharedPreferences (plain or mocked). */
        fun forTest(prefs: SharedPreferences): Secrets = Secrets(prefs)
    }
}
