package com.visvine.mobile.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/** Screens read the active palette via `VisvineTheme.colors`. */
val LocalVisvineColors = staticCompositionLocalOf { buildColors(COLOR_THEMES[0], false) }

object VisvineTheme {
    val colors: DynamicColors
        @Composable @ReadOnlyComposable get() = LocalVisvineColors.current
}

/**
 * Wraps content in a Material3 theme derived from the active hue, and exposes
 * the full [DynamicColors] set via [LocalVisvineColors] so screens can address
 * the same tokens the web app uses.
 */
@Composable
fun VisvineTheme(
    colors: DynamicColors,
    content: @Composable () -> Unit,
) {
    val scheme = lightColorScheme(
        primary = colors.accent,
        onPrimary = Color.White,
        background = colors.bgSecondary,
        surface = colors.bgPrimary,
        onBackground = colors.textPrimary,
        onSurface = colors.textPrimary,
        error = colors.error,
    )

    CompositionLocalProvider(LocalVisvineColors provides colors) {
        MaterialTheme(
            colorScheme = scheme,
            typography = Typography(),
            content = content,
        )
    }
}
