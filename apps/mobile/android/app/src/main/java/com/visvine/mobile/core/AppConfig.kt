package com.visvine.mobile.core

import com.visvine.mobile.BuildConfig

/**
 * Build-time configuration, sourced from BuildConfig fields wired in
 * app/build.gradle.kts (which in turn read gradle properties). Replaces the
 * old EXPO_PUBLIC_* environment values that were inlined into the JS bundle.
 */
object AppConfig {
    /** Backend origin, e.g. http://10.0.2.2:3000 (emulator → host). */
    val apiBaseUrl: String = BuildConfig.API_BASE_URL.trimEnd('/')

    /** Whether the in-app "Dev login" path is offered. */
    val devAuthEnabled: Boolean = BuildConfig.DEV_AUTH_ENABLED

    /** OAuth web client id; required only for real Google sign-in. */
    val googleClientId: String = BuildConfig.GOOGLE_CLIENT_ID

    /** Custom scheme used by the OAuth deep-link callback. */
    const val DEEP_LINK_SCHEME = "visvine"
}
