import Foundation
import Observation

/// App-scoped theming state — the native equivalent of ThemeProvider. Holds the
/// selected accent, derives `DynamicColors`, and persists the choice in
/// UserDefaults (key `nb_color_theme`, the web's localStorage key).
@MainActor
@Observable
final class ThemeStore {
    private(set) var themeId: String
    private(set) var colors: DynamicColors

    private let prefs = PreferencesStore.shared

    init() {
        let accent = VVAccent.named(PreferencesStore.shared.themeId)
        themeId = accent.id
        colors = buildColors(accent: accent)
    }

    var theme: VVAccent { VVAccent.named(themeId) }
    var themes: [VVAccent] { VVAccent.all }

    func setTheme(_ id: String) {
        let accent = VVAccent.named(id)
        guard accent.id == id else { return }
        themeId = id
        colors = buildColors(accent: accent)
        prefs.themeId = id
    }
}
