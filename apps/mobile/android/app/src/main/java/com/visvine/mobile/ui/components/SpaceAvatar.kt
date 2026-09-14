package com.visvine.mobile.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.SubcomposeAsyncImage
import com.visvine.mobile.ui.theme.VisvineTheme
import kotlin.math.max
import kotlin.math.roundToInt

private fun initialsOf(name: String): String =
    name.trim().split(Regex("\\s+")).take(2).mapNotNull { it.firstOrNull()?.uppercase() }.joinToString("")

/** A space's avatar: its image, or its initials when there is none. */
@Composable
fun SpaceAvatar(
    name: String,
    imageUrl: String?,
    size: Dp = 28.dp,
    modifier: Modifier = Modifier,
) {
    val colors = VisvineTheme.colors
    val fontSize = max(10, (size.value * 0.4f).roundToInt()).sp

    val fallback: @Composable () -> Unit = {
        Box(
            modifier = Modifier.size(size).clip(CircleShape).background(colors.accent),
            contentAlignment = Alignment.Center,
        ) {
            Text(initialsOf(name), color = Color.White, fontSize = fontSize, fontWeight = FontWeight.SemiBold)
        }
    }

    if (imageUrl.isNullOrEmpty()) {
        fallback()
    } else {
        SubcomposeAsyncImage(
            model = imageUrl,
            contentDescription = name,
            contentScale = ContentScale.Crop,
            modifier = modifier.size(size).clip(CircleShape),
            error = { fallback() },
            loading = { fallback() },
        )
    }
}
