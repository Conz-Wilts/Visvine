package com.visvine.mobile.ui.state

import com.visvine.mobile.auth.AuthManager
import com.visvine.mobile.data.model.Community
import com.visvine.mobile.data.remote.ApiResult
import com.visvine.mobile.data.repository.CommunityRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChangedBy
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/**
 * App-scoped community selection — the native equivalent of CommunityProvider.
 * Refreshes when the user becomes authenticated and clears on sign-out; the
 * first community is selected by default, matching the RN behaviour.
 */
@Singleton
class CommunityManager @Inject constructor(
    authManager: AuthManager,
    private val communityRepo: CommunityRepository,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private val _communities = MutableStateFlow<List<Community>>(emptyList())
    val communities: StateFlow<List<Community>> = _communities.asStateFlow()

    private val _current = MutableStateFlow<Community?>(null)
    val current: StateFlow<Community?> = _current.asStateFlow()

    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()

    init {
        scope.launch {
            authManager.state
                .distinctUntilChangedBy { it.isAuthenticated }
                .collect { state ->
                    if (state.isAuthenticated) refresh()
                    else {
                        _communities.value = emptyList()
                        _current.value = null
                    }
                }
        }
    }

    fun setCurrent(community: Community?) {
        _current.value = community
    }

    suspend fun refresh() {
        _isLoading.value = true
        when (val res = communityRepo.getCommunities()) {
            is ApiResult.Success -> {
                _communities.value = res.data
                if (_current.value == null && res.data.isNotEmpty()) {
                    _current.value = res.data.first()
                }
            }
            is ApiResult.Failure -> Unit
        }
        _isLoading.value = false
    }
}
