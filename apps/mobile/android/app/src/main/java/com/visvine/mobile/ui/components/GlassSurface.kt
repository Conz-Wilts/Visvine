package com.visvine.mobile.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Approximates the RN BlurView "glass" pill used by the tab bar / search overlay.
 * True backdrop blur isn't portable below Android 12, so — matching the RN
 * Android fallback — we use a high-opacity translucent fill plus a hairline
 * border. (A RenderEffect backdrop blur could be layered in on API 31+.)
 */
fun Modifier.glassSurface(isDark: Boolean, cornerRadius: Dp): Modifier {
    val shape = RoundedCornerShape(cornerRadius)
    val fill = if (isDark) Color(0xD11E1E22) else Color(0xD1FFFFFF) // ~0.82 alpha
    val borderColor = if (isDark) Color.White.copy(alpha = 0.08f) else Color.Black.copy(alpha = 0.08f)
    return this
        .clip(shape)
        .background(fill)
        .border(1.dp, borderColor, shape)
}
