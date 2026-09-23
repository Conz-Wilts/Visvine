package com.visvine.mobile.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf

/** Screens read the active palette via `VisvineTheme.colors`. */
val LocalVisvineColors = staticCompositionLocalOf { buildColors(VVAccents.default) }

object VisvineTheme {
    val colors: DynamicColors
        @Composable @ReadOnlyComposable get() = LocalVisvineColors.current
}

/**
 * Wraps content in a Material3 theme derived from the active accent, and
 * exposes the full [DynamicColors] set via [LocalVisvineColors] so screens
 * address the same token roles the web app uses.
 */
@Composable
fun VisvineTheme(
    colors: DynamicColors,
    content: @Composable () -> Unit,
) {
    val scheme = lightColorScheme(
        primary = colors.accent,
        onPrimary = VVColor.fgInverse,
        background = colors.surface,
        surface = colors.surface,
        onBackground = colors.fg,
        onSurface = colors.fg,
        error = colors.danger,
    )

    CompositionLocalProvider(LocalVisvineColors provides colors) {
        MaterialTheme(
            colorScheme = scheme,
            typography = Typography(),
            content = content,
        )
    }
}
