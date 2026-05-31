package com.eis.devicelock.net

import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * Implements the HMAC-SHA256 signing scheme described in
 * `docs/DEVICE_LOCK_PROTOCOL.md` sections 4 & 5.
 *
 * Pure (no Android dependencies) so it can be exercised directly from JVM tests.
 */
object DeviceHmac {

    /**
     * Signs an outgoing **command** verification string per section 4:
     *
     *   hmac = HMAC-SHA256(device_secret, command_id + action + issued_at)
     *
     * String concatenation only — no separators — to match the backend's
     * implementation. If you change this, change the backend too.
     */
    fun signCommand(secretHex: String, commandId: String, action: String, issuedAtIso: String): String {
        val msg = commandId + action + issuedAtIso
        return hmacHex(secretHex, msg.toByteArray(Charsets.UTF_8))
    }

    /**
     * Verifies an incoming command HMAC in constant time.
     */
    fun verifyCommand(
        secretHex: String,
        commandId: String,
        action: String,
        issuedAtIso: String,
        suppliedHex: String
    ): Boolean {
        val expected = signCommand(secretHex, commandId, action, issuedAtIso)
        return constantTimeEquals(expected, suppliedHex)
    }

    /**
     * Signs an outgoing **heartbeat** body per section 5:
     *
     *   sig = HMAC-SHA256(device_secret, body + X-Issued-At)
     */
    fun signHeartbeat(secretHex: String, bodyJson: String, issuedAtIso: String): String {
        val msg = bodyJson + issuedAtIso
        return hmacHex(secretHex, msg.toByteArray(Charsets.UTF_8))
    }

    /**
     * Returns the Authorization header value:
     *
     *   Authorization: HMAC <device_id>:<sig>
     */
    fun authHeader(deviceId: String, sig: String): String = "HMAC $deviceId:$sig"

    private fun hmacHex(secretHex: String, message: ByteArray): String {
        val keyBytes = hexToBytes(secretHex)
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(keyBytes, "HmacSHA256"))
        return bytesToHex(mac.doFinal(message))
    }

    private fun hexToBytes(hex: String): ByteArray {
        require(hex.length % 2 == 0) { "hex length must be even" }
        val out = ByteArray(hex.length / 2)
        for (i in out.indices) {
            val hi = Character.digit(hex[i * 2], 16)
            val lo = Character.digit(hex[i * 2 + 1], 16)
            require(hi != -1 && lo != -1) { "non-hex character in secret" }
            out[i] = ((hi shl 4) or lo).toByte()
        }
        return out
    }

    private fun bytesToHex(bytes: ByteArray): String {
        val sb = StringBuilder(bytes.size * 2)
        for (b in bytes) {
            val v = b.toInt() and 0xFF
            sb.append(HEX[v ushr 4])
            sb.append(HEX[v and 0x0F])
        }
        return sb.toString()
    }

    private fun constantTimeEquals(a: String, b: String): Boolean {
        if (a.length != b.length) return false
        var diff = 0
        for (i in a.indices) diff = diff or (a[i].code xor b[i].code)
        return diff == 0
    }

    private val HEX = "0123456789abcdef".toCharArray()
}
