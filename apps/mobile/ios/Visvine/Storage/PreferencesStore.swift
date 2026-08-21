import Foundation

/// Non-secret UI preferences via UserDefaults — the selected hue, under the
/// same key ThemeContext uses on the web (`nb_color_theme`).
final class PreferencesStore {
    static let shared = PreferencesStore()

    private let defaults = UserDefaults.standard
    private let themeKey = "nb_color_theme"

    var themeId: String? {
        get { defaults.string(forKey: themeKey) }
        set { defaults.set(newValue, forKey: themeKey) }
    }
}
