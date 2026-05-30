package com.visvine.mobile.auth

import javax.inject.Inject
import javax.inject.Singleton

/**
 * Thin seam between MainActivity's intent plumbing and [AuthManager], so the
 * Activity never reaches into session state directly.
 */
@Singleton
class DeepLinkHandler @Inject constructor(
    private val authManager: AuthManager,
) {
    fun handle(url: String) = authManager.handleDeepLink(url)
}
