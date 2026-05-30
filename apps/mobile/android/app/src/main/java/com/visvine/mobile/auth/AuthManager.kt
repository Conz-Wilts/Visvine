package com.visvine.mobile.auth

import android.net.Uri
import com.visvine.mobile.data.model.User
import com.visvine.mobile.data.remote.ApiResult
import com.visvine.mobile.data.repository.AuthRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

data class AuthState(
    val user: User? = null,
    val isLoading: Boolean = true,
    val isAuthenticated: Boolean = false,
)

/**
 * App-scoped session holder — the native equivalent of AuthContext. Owns the
 * restore-on-launch → getSession → clear-on-401 lifecycle, the OAuth deep-link
 * parsing (success *and* error paths), and the pending-route hint used to land
 * the user on the right tab after sign-in.
 */
@Singleton
class AuthManager @Inject constructor(
    private val authRepo: AuthRepository,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private val _state = MutableStateFlow(AuthState())
    val state: StateFlow<AuthState> = _state.asStateFlow()

    private val _pendingRoute = MutableStateFlow<String?>(null)
    val pendingRoute: StateFlow<String?> = _pendingRoute.asStateFlow()

    private val _authError = MutableSharedFlow<String>(extraBufferCapacity = 1)
    val authError: SharedFlow<String> = _authError.asSharedFlow()

    private val handledUrls = mutableSetOf<String>()

    init {
        checkSession()
    }

    /** Restore a saved token and validate it; clear on failure. */
    fun checkSession() {
        scope.launch {
            when (val res = authRepo.getSession()) {
                is ApiResult.Success -> _state.value = AuthState(res.data, false, true)
                is ApiResult.Failure -> {
                    authRepo.clearToken()
                    _state.value = AuthState(null, false, false)
                }
            }
        }
    }

    /** Used by the dev-login path: set the user and persist its token directly. */
    fun setUser(user: User?, token: String?) {
        if (token != null) authRepo.saveToken(token)
        _state.value = _state.value.copy(
            user = user,
            isAuthenticated = user != null,
            isLoading = false,
        )
    }

    fun logout() {
        scope.launch {
            authRepo.signOut()
            authRepo.clearToken()
            handledUrls.clear()
            _state.value = AuthState(null, false, false)
        }
    }

    fun clearPendingRoute() {
        _pendingRoute.value = null
    }

    /**
     * Handle a visvine:// deep link. Faithful port of AuthContext.handleDeepLink,
     * extended to cover the error callback (`visvine://auth/error?error=…`).
     */
    fun handleDeepLink(url: String) {
        if (url in handledUrls) return
        val uri = runCatching { Uri.parse(url) }.getOrNull() ?: return
        if (uri.host != "auth") return
        val segment = uri.pathSegments.firstOrNull()

        when (segment) {
            "error" -> {
                handledUrls.add(url)
                val code = uri.getQueryParameter("error")
                val message = uri.getQueryParameter("message")
                _authError.tryEmit(message ?: messageForError(code))
                _state.value = _state.value.copy(isLoading = false)
            }

            "callback" -> {
                val token = uri.getQueryParameter("token") ?: return
                handledUrls.add(url)
                val callbackUrl = uri.getQueryParameter("callbackUrl")
                _state.value = _state.value.copy(isLoading = true)
                scope.launch {
                    authRepo.saveToken(token)
                    when (val res = authRepo.getSession()) {
                        is ApiResult.Success -> {
                            _pendingRoute.value = routeFromCallback(callbackUrl)
                            _state.value = AuthState(res.data, false, true)
                        }
                        is ApiResult.Failure -> {
                            authRepo.clearToken()
                            _state.value = AuthState(null, false, false)
                        }
                    }
                }
            }
        }
    }

    // Decode callbackUrl ("/directory") → tab name ("Directory"), matching AuthContext.
    private fun routeFromCallback(callbackUrl: String?): String {
        val decoded = callbackUrl?.let { Uri.decode(it) } ?: "/directory"
        val route = decoded.removePrefix("/")
        return route.replaceFirstChar { it.uppercase() }.ifBlank { "Directory" }
    }

    private fun messageForError(code: String?): String = when (code) {
        // The web-only claim path can't complete on mobile (see google-mobile route).
        "account_claim_required" -> "Please sign in on web first to claim your account"
        else -> "Sign in failed. Please try again."
    }
}
