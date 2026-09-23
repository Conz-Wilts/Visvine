package com.visvine.mobile.ui.components

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.visvine.mobile.ui.theme.VVFontSize
import com.visvine.mobile.ui.theme.VVSpace
import com.visvine.mobile.ui.theme.VisvineTheme

/** The day a thread moved on to — one centred muted line between bubbles. */
@Composable
fun DateSeparator(label: String, modifier: Modifier = Modifier) {
    val colors = VisvineTheme.colors
    Box(modifier = modifier.fillMaxWidth().padding(vertical = VVSpace.x1), contentAlignment = Alignment.Center) {
        Text(label, color = colors.fgMuted, fontSize = VVFontSize.s11)
    }
}
