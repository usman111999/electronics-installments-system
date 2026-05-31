package com.eis.devicelock.net

import com.eis.devicelock.util.Secrets
import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.logging.HttpLoggingInterceptor
import timber.log.Timber
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.TimeUnit

/**
 * Thin OkHttp + Moshi client used by enrollment, heartbeats and any
 * future device → server endpoint. Signing is computed and attached
 * just-in-time for endpoints that need it; the enrollment call uses
 * the `token` parameter, not HMAC.
 */
class ApiClient(private val secrets: Secrets) {

    private val moshi: Moshi = Moshi.Builder()
        .add(KotlinJsonAdapterFactory())
        .build()

    private val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .addInterceptor(HttpLoggingInterceptor { msg -> Timber.tag("HTTP").d(msg) }
            .setLevel(HttpLoggingInterceptor.Level.BASIC))
        .build()

    /** Enrollment: token-gated, no HMAC yet (we don't have the secret pinned to device_id). */
    @Throws(Exception::class)
    fun enroll(url: String, body: EnrollRequest): EnrollResponse {
        val adapter = moshi.adapter(EnrollRequest::class.java)
        val respAdapter = moshi.adapter(EnrollResponse::class.java)
        val json = adapter.toJson(body)
        val req = Request.Builder()
            .url(url)
            .post(json.toRequestBody(JSON))
            .header("Content-Type", "application/json")
            .header("X-Issued-At", isoNow())
            .build()
        http.newCall(req).execute().use { resp -> return parse(resp, respAdapter)!! }
    }

    /** Heartbeat: HMAC-signed per spec section 5. */
    @Throws(Exception::class)
    fun heartbeat(body: HeartbeatRequest): HeartbeatResponse {
        val base = secrets.get(Secrets.KEY_API_BASE_URL)
            ?: error("API base URL not stored; call enrollment first")
        val deviceId = secrets.get(Secrets.KEY_DEVICE_ID) ?: error("device_id missing")
        val secret = secrets.get(Secrets.KEY_DEVICE_SECRET) ?: error("device_secret missing")

        val adapter = moshi.adapter(HeartbeatRequest::class.java)
        val respAdapter = moshi.adapter(HeartbeatResponse::class.java)
        val json = adapter.toJson(body)
        val issuedAt = isoNow()
        val sig = DeviceHmac.signHeartbeat(secret, json, issuedAt)

        val req = Request.Builder()
            .url(joinUrl(base, "/api/devices/heartbeat"))
            .post(json.toRequestBody(JSON))
            .header("Content-Type", "application/json")
            .header("Authorization", DeviceHmac.authHeader(deviceId, sig))
            .header("X-Issued-At", issuedAt)
            .build()
        http.newCall(req).execute().use { resp -> return parse(resp, respAdapter)!! }
    }

    private fun <T> parse(resp: Response, adapter: com.squareup.moshi.JsonAdapter<T>): T? {
        val body = resp.body?.string().orEmpty()
        if (!resp.isSuccessful) {
            throw RuntimeException("HTTP ${resp.code}: ${body.take(500)}")
        }
        return adapter.fromJson(body)
    }

    companion object {
        private val JSON = "application/json; charset=utf-8".toMediaType()
        fun isoNow(): String {
            val df = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
            df.timeZone = TimeZone.getTimeZone("UTC")
            return df.format(Date())
        }
        fun joinUrl(base: String, path: String): String {
            val b = base.trimEnd('/')
            val p = if (path.startsWith("/")) path else "/$path"
            return b + p
        }
    }
}
