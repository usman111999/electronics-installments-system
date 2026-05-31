package com.eis.devicelock.net

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Cross-contract interop test — pins the byte-exact HMAC outputs that the
 * Node backend ALSO produces for the same fixtures. If either side changes
 * its serialization, key handling, or hashing primitive, this test breaks
 * (or the corresponding backend test breaks) and the operator sees the
 * incompatibility before it ships.
 *
 * Same fixtures live in backend/__tests__/deviceHmac.test.js
 *   • SECRET = "0"*62 + "01"
 *   • command signing:   msg = "cmd-1" + "lock" + "2026-05-24T12:00:00Z"
 *                        => a025197f...3fd777
 *   • heartbeat signing: body = '{"imei":"123"}'
 *                        msg = body + "2026-05-24T12:00:00Z"
 *                        => fde88d79...8d6308
 */
class DeviceHmacInteropTest {

    private val secret = "0".repeat(62) + "01"

    @Test fun `command hmac matches reference vector from Node backend`() {
        val sig = DeviceHmac.signCommand(secret, "cmd-1", "lock", "2026-05-24T12:00:00Z")
        assertEquals(
            "a025197f7a8096058d0fbf8ff8099225384d5e22f38ff114f5e9d588103fd777",
            sig
        )
    }

    @Test fun `heartbeat hmac matches reference vector from Node backend`() {
        val sig = DeviceHmac.signHeartbeat(secret, """{"imei":"123"}""", "2026-05-24T12:00:00Z")
        assertEquals(
            "fde88d798161fbeb08af5b5dc5e26a18a60ab4fd025cdcab868d0138cd8d6308",
            sig
        )
    }
}
