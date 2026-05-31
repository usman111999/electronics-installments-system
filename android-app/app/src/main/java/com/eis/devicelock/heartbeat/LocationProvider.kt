package com.eis.devicelock.heartbeat

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import kotlinx.coroutines.CancellableContinuation
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import timber.log.Timber
import kotlin.coroutines.resume

/**
 * Wrapper around FusedLocationProviderClient.
 *
 * We use PRIORITY_BALANCED_POWER_ACCURACY because we don't need GPS-grade
 * precision for "is the phone in or near the customer's listed address?"
 * and we want to be friendly to the battery on every-30-min cadence.
 *
 * Returns null if permission is missing or no location is available
 * within [timeoutMs]; the heartbeat is still sent without lat/lon.
 */
class LocationProvider(private val context: Context) {

    @SuppressLint("MissingPermission")
    suspend fun fetchCurrent(timeoutMs: Long = 30_000): Location? {
        if (!hasLocationPermission()) {
            Timber.w("No location permission; skipping fix")
            return null
        }
        val client = LocationServices.getFusedLocationProviderClient(context)
        return withTimeoutOrNull(timeoutMs) {
            suspendCancellableCoroutine<Location?> { cont: CancellableContinuation<Location?> ->
                client.getCurrentLocation(Priority.PRIORITY_BALANCED_POWER_ACCURACY, null)
                    .addOnSuccessListener { loc ->
                        if (cont.isActive) cont.resume(loc)
                    }
                    .addOnFailureListener { t ->
                        Timber.w(t, "getCurrentLocation failed")
                        if (cont.isActive) cont.resume(null)
                    }
            }
        }
    }

    private fun hasLocationPermission(): Boolean {
        val fine = ContextCompat.checkSelfPermission(
            context, Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
        val coarse = ContextCompat.checkSelfPermission(
            context, Manifest.permission.ACCESS_COARSE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
        return fine || coarse
    }
}
