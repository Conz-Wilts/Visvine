import Foundation

/// Non-secret UI preferences via UserDefaults — the selected hue, under the
/// same key ThemeContext uses on the web (`nb_color_theme`), and the space
/// the person was last in, so a relaunch opens where they left off.
final class PreferencesStore {
    static let shared = PreferencesStore()

    private let defaults = UserDefaults.standard
    private let themeKey = "nb_color_theme"
    private let spaceKey = "visvine_current_space_id"

    var themeId: String? {
        get { defaults.string(forKey: themeKey) }
        set { defaults.set(newValue, forKey: themeKey) }
    }

    var currentSpaceId: String? {
        get { defaults.string(forKey: spaceKey) }
        set { defaults.set(newValue, forKey: spaceKey) }
    }
}
