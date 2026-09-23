package com.visvine.mobile.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.visvine.mobile.ui.theme.VVFontSize
import com.visvine.mobile.ui.theme.VVSpace
import com.visvine.mobile.ui.theme.VisvineTheme

/**
 * One message in a thread. Mine sits right on the accent in white; another's
 * sits left on `bgPrimary`, or on `bgTertiary` when an agent said it. The
 * corner nearest the sender is the 6dp tail. [leading] draws beside another's
 * bubble — an avatar — and nothing beside mine.
 */
@Composable
fun MessageBubble(
    text: String,
    isOwn: Boolean,
    time: String?,
    modifier: Modifier = Modifier,
    senderName: String? = null,
    agent: Boolean = false,
    muted: Boolean = false,
    leading: (@Composable () -> Unit)? = null,
) {
    val colors = VisvineTheme.colors
    val fill = when {
        isOwn -> colors.accent
        agent || muted -> colors.surfaceMuted
        else -> colors.surface
    }
    val ink = when {
        isOwn -> Color.White
        muted -> colors.fgMuted
        else -> colors.fg
    }

    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = if (isOwn) Arrangement.End else Arrangement.Start,
    ) {
        if (!isOwn && leading != null) leading()
        Column(
            modifier = Modifier
                .widthIn(max = 280.dp)
                .padding(start = if (isOwn || leading == null) 0.dp else 8.dp)
                .clip(
                    if (isOwn) RoundedCornerShape(18.dp, 18.dp, 6.dp, 18.dp)
                    else RoundedCornerShape(18.dp, 18.dp, 18.dp, 6.dp),
                )
                .background(fill)
                .padding(VVSpace.x3),
        ) {
            if (!isOwn && !senderName.isNullOrBlank()) {
                Text(senderName, color = colors.fgMuted, fontSize = VVFontSize.s12, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(bottom = VVSpace.x1))
            }
            Text(text, color = ink, fontSize = VVFontSize.s15)
            if (time != null) {
                Text(
                    time,
                    color = if (isOwn) Color.White.copy(alpha = 0.7f) else colors.fgSubtle,
                    fontSize = VVFontSize.s10,
                    modifier = Modifier.padding(top = VVSpace.x1),
                )
            }
        }
    }
}
