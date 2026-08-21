import SwiftUI

extension Color {
    /// 0xRRGGBB opaque color.
    init(hex: UInt32) {
        let r = Double((hex >> 16) & 0xFF) / 255
        let g = Double((hex >> 8) & 0xFF) / 255
        let b = Double(hex & 0xFF) / 255
        self.init(red: r, green: g, blue: b)
    }
}

/// One selectable hue — mirrors ThemeContext.ColorTheme (8 of these).
struct ColorTheme: Identifiable {
    let id: String
    let name: String
    let accent: Color
    let accentDark: Color
    let accentLight: Color
    let accentBg: Color
}

/// The 8 hues, in order, from ThemeContext.COLOR_THEMES.
let COLOR_THEMES: [ColorTheme] = [
    ColorTheme(id: "green", name: "Green", accent: Color(hex: 0x78D870), accentDark: Color(hex: 0x2F7A3E), accentLight: Color(hex: 0xEAF9EC), accentBg: Color(hex: 0xF5F7F5)),
    ColorTheme(id: "blue", name: "Blue", accent: Color(hex: 0x60A5FA), accentDark: Color(hex: 0x1D4ED8), accentLight: Color(hex: 0xEFF6FF), accentBg: Color(hex: 0xF5F7FF)),
    ColorTheme(id: "purple", name: "Purple", accent: Color(hex: 0xA78BFA), accentDark: Color(hex: 0x6D28D9), accentLight: Color(hex: 0xF5F3FF), accentBg: Color(hex: 0xF7F5FF)),
    ColorTheme(id: "rose", name: "Rose", accent: Color(hex: 0xF87171), accentDark: Color(hex: 0xDC2626), accentLight: Color(hex: 0xFFF1F2), accentBg: Color(hex: 0xFFF5F5)),
    ColorTheme(id: "orange", name: "Orange", accent: Color(hex: 0xFB923C), accentDark: Color(hex: 0xC2410C), accentLight: Color(hex: 0xFFF7ED), accentBg: Color(hex: 0xFDF8F5)),
    ColorTheme(id: "teal", name: "Teal", accent: Color(hex: 0x2DD4BF), accentDark: Color(hex: 0x0F766E), accentLight: Color(hex: 0xF0FDFA), accentBg: Color(hex: 0xF5FDFB)),
    ColorTheme(id: "pink", name: "Pink", accent: Color(hex: 0xF472B6), accentDark: Color(hex: 0xBE185D), accentLight: Color(hex: 0xFDF2F8), accentBg: Color(hex: 0xFEF5FB)),
    ColorTheme(id: "indigo", name: "Indigo", accent: Color(hex: 0x818CF8), accentDark: Color(hex: 0x3730A3), accentLight: Color(hex: 0xEEF2FF), accentBg: Color(hex: 0xF5F5FF)),
]

func themeBy(id: String?) -> ColorTheme {
    COLOR_THEMES.first { $0.id == id } ?? COLOR_THEMES[0]
}

/// The full set of resolved colors a view draws with — mirrors ThemeContext DynamicColors.
struct DynamicColors {
    let accent: Color
    let accentDark: Color
    let accentLight: Color
    let accentBg: Color
    let bgPrimary: Color
    let bgSecondary: Color
    let bgTertiary: Color
    let textPrimary: Color
    let textSecondary: Color
    let textMuted: Color
    let textLight: Color
    let borderLight: Color
    let borderDefault: Color
    let borderSubtle: Color
    let success: Color
    let error: Color
    let warning: Color
}

/// The colours every view draws with — the native mirror of ThemeContext's
/// applyAll(). The web app is light-only, so this is one palette, not two.
func buildColors(theme: ColorTheme) -> DynamicColors {
    return DynamicColors(
        accent: theme.accent,
        accentDark: theme.accentDark,
        accentLight: theme.accentLight,
        accentBg: theme.accentBg,
        bgPrimary: Color(hex: 0xFFFFFF),
        bgSecondary: Color(hex: 0xF9FAFB),
        bgTertiary: Color(hex: 0xF3F4F6),
        textPrimary: Color(hex: 0x111827),
        textSecondary: Color(hex: 0x374151),
        textMuted: Color(hex: 0x6B7280),
        textLight: Color(hex: 0x9CA3AF),
        borderLight: Color(hex: 0xF3F4F6),
        borderDefault: Color(hex: 0xD1D5DB),
        borderSubtle: Color(hex: 0xE5E7EB),
        success: Color(hex: 0x16A34A),
        error: Color(hex: 0xEF4444),
        warning: Color(hex: 0xF59E0B)
    )
}
