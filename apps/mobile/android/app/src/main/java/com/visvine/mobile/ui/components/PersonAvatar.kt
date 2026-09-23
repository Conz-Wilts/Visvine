package com.visvine.mobile.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.sp
import coil.compose.SubcomposeAsyncImage
import com.visvine.mobile.ui.theme.VisvineTheme
import kotlin.math.max
import kotlin.math.roundToInt

private fun initialsOf(name: String): String =
    name.trim().split(Regex("\\s+")).take(2).mapNotNull { it.firstOrNull()?.uppercase() }.joinToString("")

/**
 * A person's avatar: their image, else their initials on `accentLight`, else
 * — for something that is not a person, an agent say — a glyph centred on the
 * same disc. One shape for every row that names someone.
 */
@Composable
fun PersonAvatar(
    name: String,
    imageUrl: String?,
    size: Dp,
    modifier: Modifier = Modifier,
    glyph: Painter? = null,
) {
    val colors = VisvineTheme.colors
    val fontSize = max(10, (size.value * 0.4f).roundToInt()).sp
    val initials = initialsOf(name)

    val fallback: @Composable () -> Unit = {
        Box(
            modifier = Modifier.size(size).clip(CircleShape).background(colors.accentSoft),
            contentAlignment = Alignment.Center,
        ) {
            if (glyph != null) {
                Icon(glyph, contentDescription = name, tint = colors.accentStrong, modifier = Modifier.size(size * 0.5f))
            } else {
                Text(initials.ifEmpty { "?" }, color = colors.accentStrong, fontSize = fontSize, fontWeight = FontWeight.SemiBold)
            }
        }
    }

    if (imageUrl.isNullOrEmpty()) {
        Box(modifier = modifier) { fallback() }
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
