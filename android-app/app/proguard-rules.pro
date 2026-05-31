# Keep Firebase / FCM
-keep class com.google.firebase.** { *; }
-keep class com.google.android.gms.** { *; }

# Keep DeviceAdminReceiver
-keep class com.eis.devicelock.admin.** { *; }

# Moshi
-keepclassmembers class * {
    @com.squareup.moshi.* <methods>;
    @com.squareup.moshi.* <fields>;
}
-keep class com.squareup.moshi.** { *; }
-keep class com.eis.devicelock.net.** { *; }

# OkHttp
-dontwarn okhttp3.**
-dontwarn okio.**

# Kotlin metadata
-keep class kotlin.Metadata { *; }
-keepclassmembers class kotlin.Metadata { *; }

# WorkManager
-keep class androidx.work.** { *; }
