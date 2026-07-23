# Add project specific ProGuard rules here.
-keepattributes *Annotation*, Signature, InnerClasses, EnclosingMethod
-keepclassmembers class ** {
    @androidx.annotation.Keep *;
}
# OkHttp / platform
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn org.conscrypt.**
