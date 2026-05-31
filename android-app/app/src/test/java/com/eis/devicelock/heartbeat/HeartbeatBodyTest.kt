package com.eis.devicelock.heartbeat

import com.eis.devicelock.net.HeartbeatRequest
import com.squareup.moshi.Moshi
import com.squareup.moshi.Types
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the heartbeat JSON shape matches protocol section 5 — every
 * documented field is present with the same name and a tolerable type.
 * Uses Moshi (pure JVM) to parse so we don't depend on org.json stubs.
 */
class HeartbeatBodyTest {

    private val moshi = Moshi.Builder().add(KotlinJsonAdapterFactory()).build()
    private val mapAdapter = moshi.adapter<Map<String, Any?>>(
        Types.newParameterizedType(Map::class.java, String::class.java, Any::class.java)
    )

    @Test fun `body emits all spec-required fields`() {
        val body = HeartbeatRequest(
            imei = "352099001761481",
            lock_state = "locked",
            last_command_id = "c-1",
            last_command_status = "applied",
            battery_pct = 78,
            network_type = "wifi",
            sim_serial = "8992-4521-0001-2345-678",
            lat = 32.4945,
            lon = 74.5229,
            accuracy_m = 12,
            fcm_token = "fcm-xyz"
        )
        val json = moshi.adapter(HeartbeatRequest::class.java).toJson(body)
        val map = mapAdapter.fromJson(json) ?: error("could not parse")

        val required = listOf(
            "imei", "lock_state", "last_command_id", "last_command_status",
            "battery_pct", "network_type", "sim_serial",
            "lat", "lon", "accuracy_m", "fcm_token"
        )
        for (k in required) {
            assertTrue("Missing field: $k", map.containsKey(k))
        }

        assertEquals("352099001761481", map["imei"])
        assertEquals("locked", map["lock_state"])
        assertEquals("wifi", map["network_type"])
        // Moshi parses numbers as Double by default
        assertEquals(78.0, (map["battery_pct"] as Number).toDouble(), 0.0)
        assertEquals(32.4945, (map["lat"] as Number).toDouble(), 1e-9)
        assertEquals(74.5229, (map["lon"] as Number).toDouble(), 1e-9)
        assertEquals(12.0, (map["accuracy_m"] as Number).toDouble(), 0.0)
    }

    @Test fun `null fields serialize as JSON null when serializeNulls is on`() {
        val body = HeartbeatRequest(
            imei = "1",
            lock_state = "unlocked",
            last_command_id = null,
            last_command_status = null,
            battery_pct = 50,
            network_type = "none",
            sim_serial = null,
            lat = null,
            lon = null,
            accuracy_m = null,
            fcm_token = null
        )
        val json = moshi.adapter(HeartbeatRequest::class.java).serializeNulls().toJson(body)
        val map = mapAdapter.fromJson(json) ?: error("could not parse")
        assertTrue(map.containsKey("lat") && map["lat"] == null)
        assertTrue(map.containsKey("lon") && map["lon"] == null)
        assertTrue(map.containsKey("accuracy_m") && map["accuracy_m"] == null)
        assertTrue(map.containsKey("sim_serial") && map["sim_serial"] == null)
        assertEquals("unlocked", map["lock_state"])
    }
}
