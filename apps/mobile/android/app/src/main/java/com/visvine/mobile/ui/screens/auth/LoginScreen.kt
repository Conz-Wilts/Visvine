package com.visvine.mobile.ui.screens.auth

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.visvine.mobile.core.AppConfig
import com.visvine.mobile.ui.icons.AppIcons
import com.visvine.mobile.ui.theme.VVFontSize
import com.visvine.mobile.ui.theme.VVRadius
import com.visvine.mobile.ui.theme.VVSpace
import com.visvine.mobile.ui.theme.VisvineTheme
import com.visvine.mobile.ui.viewmodel.AuthViewModel


/** The signed-out screen: sign in with Google, with the dev bypass behind it. */
@Composable
fun LoginScreen(
    onDevLogin: () -> Unit,
    authViewModel: AuthViewModel = hiltViewModel(),
) {
    val colors = VisvineTheme.colors
    val context = LocalContext.current
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        authViewModel.authError.collect { error = it }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.surface)
            .statusBarsPadding()
            .padding(horizontal = VVSpace.x6),
        contentAlignment = Alignment.Center,
    ) {
        Column(modifier = Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(AppIcons.Network, contentDescription = null, tint = colors.accent, modifier = Modifier.size(64.dp))
            Text("Visvine", color = colors.fg, fontSize = 34.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = VVSpace.x4))
            Text("Connect with your space", color = colors.fgMuted, fontSize = VVFontSize.s16, modifier = Modifier.padding(top = VVSpace.x2))

            error?.let {
                Text(it, color = colors.danger, fontSize = VVFontSize.s14, textAlign = TextAlign.Center, modifier = Modifier.padding(top = VVSpace.x4))
            }

            Button(
                onClick = { authViewModel.startGoogleSignIn(context) },
                colors = ButtonDefaults.buttonColors(containerColor = colors.accent),
                shape = RoundedCornerShape(VVRadius.lg),
                modifier = Modifier.fillMaxWidth().padding(top = VVSpace.x12),
            ) {
                Text("Continue with Google", color = Color.White, fontSize = VVFontSize.s16, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(vertical = VVSpace.x1_5))
            }

            if (AppConfig.devAuthEnabled) {
                Button(
                    onClick = onDevLogin,
                    colors = ButtonDefaults.buttonColors(containerColor = colors.surfaceSubtle),
                    shape = RoundedCornerShape(VVRadius.lg),
                    modifier = Modifier.fillMaxWidth().padding(top = VVSpace.x3),
                ) {
                    Icon(AppIcons.Tool, contentDescription = null, tint = colors.fgSecondary, modifier = Modifier.size(20.dp))
                    Text("Dev login (skip Google)", color = colors.fgSecondary, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(start = VVSpace.x2_5, top = VVSpace.x1, bottom = VVSpace.x1))
                }
            }

            Text(
                "By signing in, you agree to our Terms of Service and Privacy Policy",
                color = colors.fgMuted,
                fontSize = VVFontSize.s12,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = VVSpace.x8, start = VVSpace.x4, end = VVSpace.x4),
            )
        }
    }
}
