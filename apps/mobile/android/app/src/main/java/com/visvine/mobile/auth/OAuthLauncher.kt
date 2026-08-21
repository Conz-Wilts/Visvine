package com.visvine.mobile.auth

import android.content.Context
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import com.visvine.mobile.core.AppConfig
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Launches Google OAuth in a Chrome Custom Tab. The server-mediated code
 * exchange happens at `/api/auth/callback/google-mobile`, which redirects back
 * to `visvine://auth/callback?token=…`; that deep link is caught by the
 * manifest intent filter and routed through [AuthManager]. Nothing here watches
 * the tab for a result — the OS deep link is what drives the return.
 */
@Singleton
class OAuthLauncher @Inject constructor(
    private val json: Json,
) {
    /** The visvine:// URL the backend redirects to after the code exchange. */
    private val redirectUri = "${AppConfig.DEEP_LINK_SCHEME}://auth/callback"

    fun authUrl(): String {
        val stateJson: JsonObject = buildJsonObject {
            put("state", UUID.randomUUID().toString())
            put("redirectUri", redirectUri)
            put("callbackUrl", "/directory")
        }
        val params = listOf(
            "client_id" to AppConfig.googleClientId,
            "redirect_uri" to "${AppConfig.apiBaseUrl}/api/auth/callback/google-mobile",
            "response_type" to "code",
            "scope" to "openid email profile",
            "state" to json.encodeToString<JsonObject>(stateJson),
        ).joinToString("&") { (k, v) -> "$k=${URLEncoder.encode(v, StandardCharsets.UTF_8.name())}" }

        return "https://accounts.google.com/o/oauth2/v2/auth?$params"
    }

    fun launch(context: Context) {
        CustomTabsIntent.Builder()
            .setShowTitle(true)
            .build()
            .launchUrl(context, Uri.parse(authUrl()))
    }
}
