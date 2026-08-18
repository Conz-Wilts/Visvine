package com.visvine.mobile.ui.screens.auth

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.visvine.mobile.core.AppConfig
import com.visvine.mobile.ui.icons.AppIcons
import com.visvine.mobile.ui.theme.VisvineTheme
import com.visvine.mobile.ui.viewmodel.AuthViewModel


/** Port of screens/Auth/LoginScreen.tsx. */
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
            .background(colors.bgSecondary)
            .statusBarsPadding()
            .padding(horizontal = 24.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(modifier = Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
            Box(
                modifier = Modifier.size(110.dp).clip(CircleShape).background(colors.accentLight),
                contentAlignment = Alignment.Center,
            ) {
                Icon(AppIcons.Network, contentDescription = null, tint = colors.accent, modifier = Modifier.size(64.dp))
            }
            Text("Visvine", color = colors.textPrimary, fontSize = 34.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 16.dp))
            Text("Connect with your space", color = colors.textMuted, fontSize = 16.sp, modifier = Modifier.padding(top = 8.dp))

            error?.let {
                Text(it, color = colors.error, fontSize = 14.sp, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 16.dp))
            }

            Button(
                onClick = { authViewModel.startGoogleSignIn(context) },
                colors = ButtonDefaults.buttonColors(containerColor = colors.accent),
                shape = RoundedCornerShape(14.dp),
                modifier = Modifier.fillMaxWidth().padding(top = 48.dp),
            ) {
                Text("Continue with Google", color = Color.White, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(vertical = 6.dp))
            }

            if (AppConfig.devAuthEnabled) {
                OutlinedButton(
                    onClick = onDevLogin,
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                ) {
                    Icon(AppIcons.Tool, contentDescription = null, tint = colors.accentDark, modifier = Modifier.size(20.dp))
                    Text("Dev login (skip Google)", color = colors.accentDark, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(start = 10.dp, top = 4.dp, bottom = 4.dp))
                }
            }

            Text(
                "By signing in, you agree to our Terms of Service and Privacy Policy",
                color = colors.textMuted,
                fontSize = 12.sp,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 32.dp, start = 16.dp, end = 16.dp),
            )
        }
    }
}
