package com.visvine.mobile.data.repository

import com.visvine.mobile.data.local.TokenStore
import com.visvine.mobile.data.model.DevUser
import com.visvine.mobile.data.model.HandoffRequest
import com.visvine.mobile.data.model.IssueTokenRequest
import com.visvine.mobile.data.model.IssueTokenResponse
import com.visvine.mobile.data.model.User
import com.visvine.mobile.data.remote.ApiResult
import com.visvine.mobile.data.remote.MediaUrl
import com.visvine.mobile.data.remote.VisvineApi
import com.visvine.mobile.data.remote.safeApiCall
import kotlinx.serialization.json.Json
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Token lifecycle + session retrieval. Mirrors AuthContext: restore-on-launch →
 * getSession → clear-on-401. The token itself lives in [TokenStore]; the
 * interceptor reads it on every call.
 */
@Singleton
class AuthRepository @Inject constructor(
    private val api: VisvineApi,
    private val tokenStore: TokenStore,
    private val json: Json,
) {
    fun savedToken(): String? = tokenStore.currentToken()

    fun saveToken(token: String) = tokenStore.save(token)

    fun clearToken() = tokenStore.clear()

    /** Resolves the current session into a [User], or a failure if none/expired. */
    suspend fun getSession(): ApiResult<User> =
        when (val res = safeApiCall(json) { api.getSession() }) {
            is ApiResult.Success -> {
                val user = res.data.session?.user
                if (user != null) ApiResult.Success(user.copy(image = MediaUrl.resolve(user.image)))
                else ApiResult.Failure("No session")
            }
            is ApiResult.Failure -> res
        }

    /**
     * Trades the handoff the browser returned for a session, proving with the
     * verifier that this app is the one that started the sign-in.
     */
    suspend fun redeemHandoff(handoff: String, verifier: String): ApiResult<String> =
        when (val res = safeApiCall(json) { api.redeemHandoff(HandoffRequest(handoff, verifier)) }) {
            is ApiResult.Success -> ApiResult.Success(res.data.token)
            is ApiResult.Failure -> res
        }

    /** Best-effort server sign-out; the token is always cleared locally by the caller. */
    suspend fun signOut() {
        runCatching { api.signOut() }
    }

    // ── Dev login ────────────────────────────────────────────────────────────
    suspend fun listDevUsers(): ApiResult<List<DevUser>> =
        when (val res = safeApiCall(json) { api.listDevUsers() }) {
            is ApiResult.Success -> ApiResult.Success(res.data.users)
            is ApiResult.Failure -> res
        }

    suspend fun issueDevToken(userId: String): ApiResult<IssueTokenResponse> =
        safeApiCall(json) { api.issueDevToken(IssueTokenRequest(userId)) }
}
