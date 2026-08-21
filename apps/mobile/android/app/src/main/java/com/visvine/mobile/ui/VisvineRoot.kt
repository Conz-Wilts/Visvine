package com.visvine.mobile.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.visvine.mobile.core.KillSwitch
import com.visvine.mobile.ui.components.Loading
import com.visvine.mobile.ui.navigation.AuthedNavHost
import com.visvine.mobile.ui.navigation.UnauthNavHost
import com.visvine.mobile.ui.theme.VisvineTheme
import com.visvine.mobile.ui.viewmodel.RootViewModel

/**
 * Top-level composable. Applies the active theme, then gates the UI on
 * (1) the remote kill-switch, (2) the auth-loading splash, and (3) the
 * authenticated/unauthenticated graph.
 */
@Composable
fun VisvineRoot(rootViewModel: RootViewModel = hiltViewModel()) {
    val colors by rootViewModel.colors.collectAsStateWithLifecycle()
    val auth by rootViewModel.authState.collectAsStateWithLifecycle()
    val pendingRoute by rootViewModel.pendingRoute.collectAsStateWithLifecycle()
    val killSwitch by rootViewModel.killSwitch.collectAsStateWithLifecycle()

    VisvineTheme(colors = colors) {
        Surface(modifier = Modifier.fillMaxSize(), color = colors.bgSecondary) {
            when (val gate = killSwitch) {
                is KillSwitch.State.Disabled -> BlockingScreen("Visvine is unavailable", gate.message)
                is KillSwitch.State.UpdateRequired -> BlockingScreen("Update required", gate.message)
                KillSwitch.State.Operational -> when {
                    auth.isLoading -> Loading(fullScreen = true, message = "Signing you in…")
                    auth.isAuthenticated -> AuthedNavHost(
                        pendingRoute = pendingRoute,
                        onPendingRouteConsumed = rootViewModel::clearPendingRoute,
                    )
                    else -> UnauthNavHost()
                }
            }
        }
    }
}

@Composable
private fun BlockingScreen(title: String, message: String) {
    val colors = VisvineTheme.colors
    Column(
        modifier = Modifier.fillMaxSize().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(title, color = colors.textPrimary, fontSize = 20.sp, fontWeight = FontWeight.Bold)
        Text(
            message,
            color = colors.textMuted,
            fontSize = 15.sp,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 8.dp),
        )
    }
}
