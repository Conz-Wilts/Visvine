import Foundation
import Observation

/// App-scoped theming state — the native equivalent of ThemeProvider. Holds the
/// selected hue, derives `DynamicColors`, and persists the choice in
/// UserDefaults (key `nb_color_theme`).
@MainActor
@Observable
final class ThemeStore {
    private(set) var themeId: String
    private(set) var colors: DynamicColors

    private let prefs = PreferencesStore.shared

    init() {
        let storedId = PreferencesStore.shared.themeId ?? COLOR_THEMES[0].id
        let theme = themeBy(id: storedId)
        themeId = theme.id
        colors = buildColors(theme: theme)
    }

    var theme: ColorTheme { themeBy(id: themeId) }
    var themes: [ColorTheme] { COLOR_THEMES }

    func setTheme(_ id: String) {
        let theme = themeBy(id: id)
        guard theme.id == id else { return }
        themeId = id
        colors = buildColors(theme: theme)
        prefs.themeId = id
    }
}
