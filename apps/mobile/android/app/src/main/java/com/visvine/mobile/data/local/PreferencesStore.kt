package com.visvine.mobile.data.local

import android.content.Context
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
 * Non-secret UI preferences via DataStore — the selected hue, under the same key
 * ThemeContext uses on the web (`nb_color_theme`), and the space the person
 * last stood in, so a relaunch opens where they left off.
 */
@Singleton
class PreferencesStore @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    val themeId: Flow<String?> = context.dataStore.data.map { it[KEY_THEME] }

    suspend fun setThemeId(id: String) {
        context.dataStore.edit { it[KEY_THEME] = id }
    }

    val currentSpaceId: Flow<String?> = context.dataStore.data.map { it[KEY_CURRENT_SPACE] }

    suspend fun setCurrentSpaceId(id: String?) {
        context.dataStore.edit {
            if (id == null) it.remove(KEY_CURRENT_SPACE) else it[KEY_CURRENT_SPACE] = id
        }
    }

    private companion object {
        val KEY_THEME = stringPreferencesKey("nb_color_theme")
        val KEY_CURRENT_SPACE = stringPreferencesKey("visvine_current_space_id")
    }
}
