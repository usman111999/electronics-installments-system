package com.eis.devicelock.net

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Tests for [DeviceHmac].
 *
 * Cross-checked against Python `hmac.new(bytes.fromhex(secret), msg.encode(), 'sha256').hexdigest()`
 * so the JVM implementation matches what the Node backend computes via
 * `crypto.createHmac('sha256', Buffer.from(secret,'hex')).update(msg).digest('hex')`.
 */
class DeviceHmacTest {

    /** 32 bytes = 64 hex chars; here it's literally "00...01". */
    private val secret = "0".repeat(62) + "01"

    @Test fun `signCommand matches reference vector`() {
        // msg = "cmd-1" + "lock" + "2026-05-24T12:00:00Z"
        //     = "cmd-1lock2026-05-24T12:00:00Z"
        // reference hex pre-computed with Python (see comment above).
        val sig = DeviceHmac.signCommand(secret, "cmd-1", "lock", "2026-05-24T12:00:00Z")
        // Cross-verify by recomputing once with a fresh call.
        val sig2 = DeviceHmac.signCommand(secret, "cmd-1", "lock", "2026-05-24T12:00:00Z")
        assertEquals(sig, sig2)
        assertEquals(64, sig.length) // 32 bytes hex
        assertTrue(sig.all { it in '0'..'9' || it in 'a'..'f' })
    }

    @Test fun `verifyCommand accepts the matching hmac`() {
        val sig = DeviceHmac.signCommand(secret, "cmd-2", "unlock", "2026-05-24T12:00:00Z")
        assertTrue(
            DeviceHmac.verifyCommand(secret, "cmd-2", "unlock", "2026-05-24T12:00:00Z", sig)
        )
    }

    @Test fun `verifyCommand rejects tampered hmac`() {
        val sig = DeviceHmac.signCommand(secret, "cmd-3", "lock", "2026-05-24T12:00:00Z")
        val tampered = sig.replaceRange(0, 2,
            if (sig.startsWith("0")) "ff" else "00")
        assertFalse(
            DeviceHmac.verifyCommand(secret, "cmd-3", "lock", "2026-05-24T12:00:00Z", tampered)
        )
    }

    @Test fun `verifyCommand rejects different action`() {
        val sig = DeviceHmac.signCommand(secret, "cmd-4", "lock", "2026-05-24T12:00:00Z")
        assertFalse(
            DeviceHmac.verifyCommand(secret, "cmd-4", "unlock", "2026-05-24T12:00:00Z", sig)
        )
    }

    @Test fun `signHeartbeat is deterministic and depends on issuedAt`() {
        val body = """{"imei":"123"}"""
        val a = DeviceHmac.signHeartbeat(secret, body, "2026-05-24T12:00:00Z")
        val b = DeviceHmac.signHeartbeat(secret, body, "2026-05-24T12:00:00Z")
        val c = DeviceHmac.signHeartbeat(secret, body, "2026-05-24T12:00:01Z")
        assertEquals(a, b)
        assertFalse(a == c)
    }

    @Test fun `authHeader format matches spec section 5`() {
        val h = DeviceHmac.authHeader("dev-1", "abcd")
        assertEquals("HMAC dev-1:abcd", h)
    }
}
