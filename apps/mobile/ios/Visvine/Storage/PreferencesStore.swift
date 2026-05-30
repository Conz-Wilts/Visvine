import Foundation

/// Non-secret UI preferences via UserDefaults — replaces the SecureStore theme
/// keys `nb_color_theme` / `nb_dark_mode` from ThemeContext (keys kept identical).
final class PreferencesStore {
    static let shared = PreferencesStore()

    private let defaults = UserDefaults.standard
    private let themeKey = "nb_color_theme"
    private let darkKey = "nb_dark_mode"

    var themeId: String? {
        get { defaults.string(forKey: themeKey) }
        set { defaults.set(newValue, forKey: themeKey) }
    }

    var isDark: Bool {
        get { defaults.bool(forKey: darkKey) }
        set { defaults.set(newValue, forKey: darkKey) }
    }
}
