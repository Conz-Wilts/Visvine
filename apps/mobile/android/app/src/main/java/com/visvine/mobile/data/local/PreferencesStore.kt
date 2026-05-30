package com.visvine.mobile.data.local

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

private val Context.dataStore by preferencesDataStore(name = "visvine_prefs")

/**
 * Non-secret UI preferences via DataStore — replaces the SecureStore theme keys
 * `nb_color_theme` / `nb_dark_mode` from ThemeContext. Keys are kept identical
 * for traceability.
 */
@Singleton
class PreferencesStore @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    val themeId: Flow<String?> = context.dataStore.data.map { it[KEY_THEME] }
    val isDark: Flow<Boolean> = context.dataStore.data.map { it[KEY_DARK] ?: false }

    suspend fun setThemeId(id: String) {
        context.dataStore.edit { it[KEY_THEME] = id }
    }

    suspend fun setDark(dark: Boolean) {
        context.dataStore.edit { it[KEY_DARK] = dark }
    }

    private companion object {
        val KEY_THEME = stringPreferencesKey("nb_color_theme")
        val KEY_DARK = booleanPreferencesKey("nb_dark_mode")
    }
}
