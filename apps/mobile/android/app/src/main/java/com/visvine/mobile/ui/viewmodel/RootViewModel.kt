package com.visvine.mobile.ui.viewmodel

import androidx.lifecycle.ViewModel
import com.visvine.mobile.auth.AuthManager
import com.visvine.mobile.core.KillSwitch
import com.visvine.mobile.ui.theme.ThemeController
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.StateFlow
import javax.inject.Inject

/** Drives the root gate: theme, kill-switch, auth loading/routing. */
@HiltViewModel
class RootViewModel @Inject constructor(
    themeController: ThemeController,
    private val authManager: AuthManager,
    killSwitch: KillSwitch,
) : ViewModel() {
    val colors = themeController.colors
    val isDark: StateFlow<Boolean> = themeController.isDark
    val authState = authManager.state
    val pendingRoute = authManager.pendingRoute
    val killSwitch: StateFlow<KillSwitch.State> = killSwitch.state

    fun clearPendingRoute() = authManager.clearPendingRoute()
}
