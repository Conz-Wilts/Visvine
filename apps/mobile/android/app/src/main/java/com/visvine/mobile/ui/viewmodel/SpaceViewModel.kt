package com.visvine.mobile.ui.viewmodel

import androidx.lifecycle.ViewModel
import com.visvine.mobile.data.model.Space
import com.visvine.mobile.ui.state.SpaceManager
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject

@HiltViewModel
class SpaceViewModel @Inject constructor(
    private val spaceManager: SpaceManager,
) : ViewModel() {
    val spaces = spaceManager.spaces
    val current = spaceManager.current

    fun setCurrent(space: Space?) = spaceManager.setCurrent(space)
}
