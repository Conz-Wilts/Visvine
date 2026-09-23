package com.visvine.mobile.ui.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.visvine.mobile.ui.theme.VVFontSize
import com.visvine.mobile.ui.theme.VVSpace
import com.visvine.mobile.ui.theme.VisvineTheme

/**
 * Nothing here yet: a line of muted text and, if there is something to do about
 * it, a text link in the accent. No tile behind the icon, no button — an empty
 * surface should be the quietest thing on the screen. Mirrors
 * components/ui/EmptyState.tsx.
 */
@Composable
fun EmptyState(
    text: String,
    modifier: Modifier = Modifier,
    icon: Painter? = null,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
) {
    val colors = VisvineTheme.colors
    Column(
        modifier = modifier.fillMaxWidth().padding(vertical = VVSpace.x12),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(VVSpace.x3),
    ) {
        if (icon != null) {
            Icon(icon, contentDescription = null, tint = colors.fgMuted, modifier = Modifier.size(24.dp))
        }
        Text(text, color = colors.fgMuted, fontSize = VVFontSize.s15, textAlign = TextAlign.Center)
        if (actionLabel != null && onAction != null) {
            Text(
                actionLabel,
                color = colors.accentStrong,
                fontSize = VVFontSize.s14,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.clickable { onAction() },
            )
        }
    }
}
