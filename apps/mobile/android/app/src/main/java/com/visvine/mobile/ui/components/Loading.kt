package com.visvine.mobile.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.visvine.mobile.ui.theme.VisvineTheme

/** The spinner every screen waits behind — inline, or filling the screen. */
@Composable
fun Loading(
    modifier: Modifier = Modifier,
    message: String? = null,
    fullScreen: Boolean = false,
) {
    val colors = VisvineTheme.colors
    Column(
        modifier = if (fullScreen) modifier.fillMaxSize() else modifier.padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        CircularProgressIndicator(color = colors.accent)
        if (message != null) {
            Text(text = message, color = colors.textMuted, fontSize = 16.sp, modifier = Modifier.padding(top = 12.dp))
        }
    }
}
