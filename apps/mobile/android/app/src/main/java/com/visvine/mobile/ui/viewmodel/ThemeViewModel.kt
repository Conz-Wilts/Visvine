package com.visvine.mobile.ui.viewmodel

import androidx.lifecycle.ViewModel
import com.visvine.mobile.ui.theme.ThemeController
import com.visvine.mobile.ui.theme.VVAccent
import com.visvine.mobile.ui.theme.VVAccents
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject

@HiltViewModel
class ThemeViewModel @Inject constructor(
    private val themeController: ThemeController,
) : ViewModel() {
    val colors = themeController.colors
    val themeId = themeController.themeId
    val themes: List<VVAccent> = VVAccents.all

    fun setTheme(id: String) = themeController.setTheme(id)
}
