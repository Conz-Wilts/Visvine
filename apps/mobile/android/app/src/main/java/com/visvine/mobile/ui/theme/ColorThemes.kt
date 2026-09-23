package com.visvine.mobile.ui.theme

import androidx.compose.ui.graphics.Color

/**
 * The colours a screen draws with: the semantic design tokens ([VVColor], from
 * packages/tokens via Tokens.kt) plus the accent the person picked. The names
 * are the token roles — the same names the web's utilities (`text-fg-muted`,
 * `bg-surface-subtle`) and iOS's `DynamicColors` use.
 */
data class DynamicColors(
    /** The chosen hue: fills and the selected state. */
    val accent: Color,
    /** Text and icons in the accent. */
    val accentStrong: Color,
    /** A wash behind a selected row. */
    val accentSoft: Color,
    val surface: Color = VVColor.surface,
    val surfaceSubtle: Color = VVColor.surfaceSubtle,
    val surfaceMuted: Color = VVColor.surfaceMuted,
    val surfaceGlass: Color = VVColor.surfaceGlass,
    val fg: Color = VVColor.fg,
    val fgSecondary: Color = VVColor.fgSecondary,
    val fgMuted: Color = VVColor.fgMuted,
    val fgSubtle: Color = VVColor.fgSubtle,
    val line: Color = VVColor.line,
    val lineSubtle: Color = VVColor.lineSubtle,
    val danger: Color = VVColor.danger,
    val success: Color = VVColor.success,
    val warning: Color = VVColor.warning,
)

/** The palette for one accent. The app is light-only, so this is one palette, not two. */
fun buildColors(accent: VVAccent): DynamicColors =
    DynamicColors(accent = accent.light.base, accentStrong = accent.light.strong, accentSoft = accent.light.soft)
