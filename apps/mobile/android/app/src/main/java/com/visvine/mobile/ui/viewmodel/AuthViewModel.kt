package com.visvine.mobile.ui.viewmodel

import android.content.Context
import androidx.lifecycle.ViewModel
import com.visvine.mobile.auth.AuthManager
import com.visvine.mobile.auth.OAuthLauncher
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharedFlow
import javax.inject.Inject

@HiltViewModel
class AuthViewModel @Inject constructor(
    private val authManager: AuthManager,
    private val oauthLauncher: OAuthLauncher,
) : ViewModel() {
    val state = authManager.state
    val authError: SharedFlow<String> = authManager.authError

    fun startGoogleSignIn(context: Context) {
        val (challenge, nonce) = authManager.beginSignIn()
        oauthLauncher.launch(context, challenge, nonce)
    }
    fun logout() = authManager.logout()
}
