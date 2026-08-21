package com.visvine.mobile.ui.theme

import androidx.compose.ui.graphics.Color

/** One selectable hue — mirrors ThemeContext.ColorTheme (8 of these). */
data class ColorTheme(
    val id: String,
    val name: String,
    val accent: Color,
    val accentDark: Color,
    val accentLight: Color,
    val accentBg: Color,
)

/** The 8 hues, in order, from ThemeContext.COLOR_THEMES. */
val COLOR_THEMES: List<ColorTheme> = listOf(
    ColorTheme("green", "Green", Color(0xFF78D870), Color(0xFF2F7A3E), Color(0xFFEAF9EC), Color(0xFFF5F7F5)),
    ColorTheme("blue", "Blue", Color(0xFF60A5FA), Color(0xFF1D4ED8), Color(0xFFEFF6FF), Color(0xFFF5F7FF)),
    ColorTheme("purple", "Purple", Color(0xFFA78BFA), Color(0xFF6D28D9), Color(0xFFF5F3FF), Color(0xFFF7F5FF)),
    ColorTheme("rose", "Rose", Color(0xFFF87171), Color(0xFFDC2626), Color(0xFFFFF1F2), Color(0xFFFFF5F5)),
    ColorTheme("orange", "Orange", Color(0xFFFB923C), Color(0xFFC2410C), Color(0xFFFFF7ED), Color(0xFFFDF8F5)),
    ColorTheme("teal", "Teal", Color(0xFF2DD4BF), Color(0xFF0F766E), Color(0xFFF0FDFA), Color(0xFFF5FDFB)),
    ColorTheme("pink", "Pink", Color(0xFFF472B6), Color(0xFFBE185D), Color(0xFFFDF2F8), Color(0xFFFEF5FB)),
    ColorTheme("indigo", "Indigo", Color(0xFF818CF8), Color(0xFF3730A3), Color(0xFFEEF2FF), Color(0xFFF5F5FF)),
)

fun themeById(id: String?): ColorTheme = COLOR_THEMES.firstOrNull { it.id == id } ?: COLOR_THEMES[0]

/**
 * The full set of resolved colors a screen draws with — mirrors ThemeContext
 * DynamicColors. Built by [buildColors] from a hue.
 */
data class DynamicColors(
    val accent: Color,
    val accentDark: Color,
    val accentLight: Color,
    val accentBg: Color,
    val bgPrimary: Color,
    val bgSecondary: Color,
    val bgTertiary: Color,
    val textPrimary: Color,
    val textSecondary: Color,
    val textMuted: Color,
    val textLight: Color,
    val borderLight: Color,
    val borderDefault: Color,
    val borderSubtle: Color,
    val success: Color,
    val error: Color,
    val warning: Color,
)

/**
 * The colours every screen draws with — the native mirror of ThemeContext's
 * applyAll(). The web app is light-only, so this is one palette, not two.
 */
fun buildColors(theme: ColorTheme): DynamicColors =
    DynamicColors(
        accent = theme.accent,
        accentDark = theme.accentDark,
        accentLight = theme.accentLight,
        accentBg = theme.accentBg,
        bgPrimary = Color(0xFFFFFFFF),
        bgSecondary = Color(0xFFF9FAFB),
        bgTertiary = Color(0xFFF3F4F6),
        textPrimary = Color(0xFF111827),
        textSecondary = Color(0xFF374151),
        textMuted = Color(0xFF6B7280),
        textLight = Color(0xFF9CA3AF),
        borderLight = Color(0xFFF3F4F6),
        borderDefault = Color(0xFFD1D5DB),
        borderSubtle = Color(0xFFE5E7EB),
        success = Color(0xFF16A34A),
        error = Color(0xFFEF4444),
        warning = Color(0xFFF59E0B),
    )
