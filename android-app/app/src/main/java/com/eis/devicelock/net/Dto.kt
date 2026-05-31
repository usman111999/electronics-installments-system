package com.eis.devicelock.net

import com.squareup.moshi.JsonClass

/**
 * Data Transfer Objects used between the device and the server.
 *
 * All shapes are pinned to the protocol spec; touching them will break
 * the backend.
 */

@JsonClass(generateAdapter = true)
data class EnrollmentQrPayload(
    val v: Int = 1,
    val url: String,
    val token: String,
    val secret: String,
    val branch: String,
    val order: String?,
    /** Optional human-friendly branch phone shown on the lock screen. */
    val branchPhone: String? = null
)

@JsonClass(generateAdapter = true)
data class EnrollRequest(
    val token: String,
    val imei: String,
    val fcm_token: String,
    val device_model: String,
    val android_version: String
)

@JsonClass(generateAdapter = true)
data class EnrollResponse(
    val ok: Boolean,
    val device_id: String?,
    val branch_phone: String? = null,
    val error: String? = null
)

@JsonClass(generateAdapter = true)
data class HeartbeatRequest(
    val imei: String,
    val lock_state: String,
    val last_command_id: String?,
    val last_command_status: String?,
    val battery_pct: Int,
    val network_type: String,
    val sim_serial: String?,
    val lat: Double?,
    val lon: Double?,
    val accuracy_m: Int?,
    val fcm_token: String?
)

@JsonClass(generateAdapter = true)
data class HeartbeatResponse(
    val ok: Boolean,
    val error: String? = null
)

/**
 * Shape of a `data` payload received from FCM. We do not bind this with
 * Moshi (FCM hands us a Map<String,String>) but documenting it here keeps
 * the API explicit.
 */
data class CommandPayload(
    val type: String,
    val action: String,
    val commandId: String,
    val issuedAt: String,
    val reason: String?,
    val lockMessage: String?,
    val hmac: String
) {
    companion object {
        fun fromMap(m: Map<String, String>): CommandPayload? {
            val type = m["type"] ?: return null
            val action = m["action"] ?: return null
            val cid = m["command_id"] ?: return null
            val iat = m["issued_at"] ?: return null
            val hmac = m["hmac"] ?: return null
            return CommandPayload(
                type = type,
                action = action,
                commandId = cid,
                issuedAt = iat,
                reason = m["reason"],
                lockMessage = m["lock_message"],
                hmac = hmac
            )
        }
    }
}
