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
 * The "glass" pill under the tab bar and the search overlay. True backdrop blur
 * isn't portable below Android 12, so this is a high-opacity translucent fill
 * plus a hairline border. (A RenderEffect backdrop blur could be layered in on
 * API 31+.)
 */
fun Modifier.glassSurface(cornerRadius: Dp): Modifier {
    val shape = RoundedCornerShape(cornerRadius)
    val fill = Color(0xD1FFFFFF) // ~0.82 alpha
    val borderColor = Color.Black.copy(alpha = 0.08f)
    return this
        .clip(shape)
        .background(fill)
        .border(1.dp, borderColor, shape)
}
