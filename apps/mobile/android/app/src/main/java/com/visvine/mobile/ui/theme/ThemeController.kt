package com.visvine.mobile.ui.theme

import com.visvine.mobile.data.local.PreferencesStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/**
 * App-scoped theming state — the native equivalent of ThemeProvider. Holds the
 * selected accent, derives [DynamicColors], and persists the choice via DataStore
 * (key `nb_color_theme`).
 */
@Singleton
class ThemeController @Inject constructor(
    private val prefs: PreferencesStore,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private val _themeId = MutableStateFlow(VVAccents.default.id)
    val themeId: StateFlow<String> = _themeId.asStateFlow()

    private val _colors = MutableStateFlow(buildColors(VVAccents.default))
    val colors: StateFlow<DynamicColors> = _colors.asStateFlow()

    init {
        scope.launch {
            _themeId.value = VVAccents.named(prefs.themeId.first()).id
            recompute()
        }
    }

    val theme: VVAccent get() = VVAccents.named(_themeId.value)
    val themes: List<VVAccent> get() = VVAccents.all

    fun setTheme(id: String) {
        if (VVAccents.named(id).id != id) return
        _themeId.value = id
        recompute()
        scope.launch { prefs.setThemeId(id) }
    }

    private fun recompute() {
        _colors.value = buildColors(VVAccents.named(_themeId.value))
    }
}
