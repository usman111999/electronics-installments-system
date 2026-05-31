package com.eis.devicelock.util

import android.content.Context
import com.eis.devicelock.BuildConfig
import timber.log.Timber

/**
 * Lightweight Timber initialiser.
 *
 * In release builds we still write logs but with a tag prefix so adb
 * logcat shows useful information for field debugging — these devices
 * are at customer counters with no developer present.
 */
object Logger {
    fun init(@Suppress("UNUSED_PARAMETER") context: Context) {
        if (Timber.treeCount > 0) return
        if (BuildConfig.DEBUG) {
            Timber.plant(Timber.DebugTree())
        } else {
            Timber.plant(object : Timber.Tree() {
                override fun log(priority: Int, tag: String?, message: String, t: Throwable?) {
                    val realTag = "EIS/${tag ?: "?"}"
                    if (t == null) {
                        android.util.Log.println(priority, realTag, message)
                    } else {
                        android.util.Log.println(priority, realTag, "$message\n${android.util.Log.getStackTraceString(t)}")
                    }
                }
            })
        }
    }
}
