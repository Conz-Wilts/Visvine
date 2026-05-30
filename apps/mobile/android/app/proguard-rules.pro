# kotlinx.serialization — keep generated serializers for @Serializable models.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**

-keepclassmembers @kotlinx.serialization.Serializable class ** {
    static **$* *;
    *** Companion;
    *** serializer(...);
}
-keepclasseswithmembers class **$$serializer { *; }
-keep,includedescriptorclasses class com.visvine.mobile.data.model.**$$serializer { *; }
-keepclassmembers class com.visvine.mobile.data.model.** {
    *** Companion;
}

# Retrofit
-keep,allowobfuscation,allowshrinking interface retrofit2.Call
-keep,allowobfuscation,allowshrinking class retrofit2.Response
-keepattributes Signature, Exceptions

# OkHttp platform warnings
-dontwarn okhttp3.internal.platform.**
-dontwarn org.conscrypt.**
