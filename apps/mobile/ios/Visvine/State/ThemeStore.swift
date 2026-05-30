import Foundation
import Observation

/// App-scoped theming state — the native equivalent of ThemeProvider. Holds the
/// selected hue + dark toggle, derives `DynamicColors`, and persists choices in
/// UserDefaults (keys `nb_color_theme` / `nb_dark_mode`).
@MainActor
@Observable
final class ThemeStore {
    private(set) var themeId: String
    private(set) var isDark: Bool
    private(set) var colors: DynamicColors

    private let prefs = PreferencesStore.shared

    init() {
        let storedId = PreferencesStore.shared.themeId ?? COLOR_THEMES[0].id
        let dark = PreferencesStore.shared.isDark
        let theme = themeBy(id: storedId)
        themeId = theme.id
        isDark = dark
        colors = buildColors(theme: theme, isDark: dark)
    }

    var theme: ColorTheme { themeBy(id: themeId) }
    var themes: [ColorTheme] { COLOR_THEMES }

    func setTheme(_ id: String) {
        let theme = themeBy(id: id)
        guard theme.id == id else { return }
        themeId = id
        colors = buildColors(theme: theme, isDark: isDark)
        prefs.themeId = id
    }

    func toggleDark() {
        isDark.toggle()
        colors = buildColors(theme: theme, isDark: isDark)
        prefs.isDark = isDark
    }
}
