package com.visvine.mobile.auth

import android.content.Context
import android.net.Uri
import android.util.Base64
import androidx.browser.customtabs.CustomTabsIntent
import com.visvine.mobile.core.AppConfig
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.security.SecureRandom
import javax.inject.Inject
import javax.inject.Singleton

/**
 * A PKCE pair (RFC 7636): the verifier never leaves the app; the challenge
 * travels through the browser. The server's half is apps/web/lib/auth/handoff.ts.
 */
data class Pkce(val verifier: String, val challenge: String) {
    companion object {
        private const val FLAGS = Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP

        fun make(): Pkce {
            val bytes = ByteArray(32).also { SecureRandom().nextBytes(it) }
            val verifier = Base64.encodeToString(bytes, FLAGS)
            val digest = MessageDigest.getInstance("SHA-256")
                .digest(verifier.toByteArray(StandardCharsets.US_ASCII))
            return Pkce(verifier, Base64.encodeToString(digest, FLAGS))
        }
    }
}

/**
 * Launches Google OAuth in a Chrome Custom Tab. The server-mediated code
 * exchange happens at `/api/auth/callback/google-mobile`, which redirects back
 * to `visvine://auth/callback?handoff=…&state=…`; that deep link is caught by
 * the manifest intent filter and routed through [AuthManager], which redeems
 * the handoff with the verifier it kept. Nothing here watches the tab for a
 * result — the OS deep link is what drives the return.
 */
@Singleton
class OAuthLauncher @Inject constructor(
    private val json: Json,
) {
    fun authUrl(challenge: String, nonce: String): String {
        val stateJson: JsonObject = buildJsonObject {
            put("state", nonce)
            put("challenge", challenge)
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

    fun launch(context: Context, challenge: String, nonce: String) {
        CustomTabsIntent.Builder()
            .setShowTitle(true)
            .build()
            .launchUrl(context, Uri.parse(authUrl(challenge, nonce)))
    }
}
