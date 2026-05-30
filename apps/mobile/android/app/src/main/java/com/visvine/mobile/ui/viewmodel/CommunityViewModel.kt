package com.visvine.mobile.ui.viewmodel

import androidx.lifecycle.ViewModel
import com.visvine.mobile.data.model.Community
import com.visvine.mobile.ui.state.CommunityManager
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject

@HiltViewModel
class CommunityViewModel @Inject constructor(
    private val communityManager: CommunityManager,
) : ViewModel() {
    val communities = communityManager.communities
    val current = communityManager.current

    fun setCurrent(community: Community?) = communityManager.setCurrent(community)
}
