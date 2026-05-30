package com.visvine.mobile.ui.viewmodel

import androidx.lifecycle.ViewModel
import com.visvine.mobile.ui.theme.COLOR_THEMES
import com.visvine.mobile.ui.theme.ColorTheme
import com.visvine.mobile.ui.theme.ThemeController
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject

@HiltViewModel
class ThemeViewModel @Inject constructor(
    private val themeController: ThemeController,
) : ViewModel() {
    val colors = themeController.colors
    val isDark = themeController.isDark
    val themeId = themeController.themeId
    val themes: List<ColorTheme> = COLOR_THEMES

    fun setTheme(id: String) = themeController.setTheme(id)
    fun toggleDark() = themeController.toggleDark()
}
