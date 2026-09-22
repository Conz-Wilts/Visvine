package com.visvine.mobile.ui.state

import com.visvine.mobile.auth.AuthManager
import com.visvine.mobile.data.local.PreferencesStore
import com.visvine.mobile.data.model.Space
import com.visvine.mobile.data.remote.ApiResult
import com.visvine.mobile.data.repository.SpaceRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChangedBy
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/**
 * App-scoped space selection — the native equivalent of SpaceProvider.
 * Refreshes when the user becomes authenticated and clears on sign-out. The
 * space last chosen is remembered in [PreferencesStore] and preferred over the
 * first in the list, so a relaunch opens where the person left off.
 */
@Singleton
class SpaceManager @Inject constructor(
    authManager: AuthManager,
    private val spaceRepo: SpaceRepository,
    private val prefs: PreferencesStore,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private val _spaces = MutableStateFlow<List<Space>>(emptyList())
    val spaces: StateFlow<List<Space>> = _spaces.asStateFlow()

    private val _current = MutableStateFlow<Space?>(null)
    val current: StateFlow<Space?> = _current.asStateFlow()

    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()

    init {
        scope.launch {
            authManager.state
                .distinctUntilChangedBy { it.isAuthenticated }
                .collect { state ->
                    if (state.isAuthenticated) refresh()
                    else {
                        _spaces.value = emptyList()
                        _current.value = null
                    }
                }
        }
    }

    fun setCurrent(space: Space?) {
        _current.value = space
        scope.launch { prefs.setCurrentSpaceId(space?.id) }
    }

    suspend fun refresh() {
        _isLoading.value = true
        when (val res = spaceRepo.getSpaces()) {
            is ApiResult.Success -> {
                _spaces.value = res.data
                val held = _current.value
                val stale = held == null || res.data.none { it.id == held.id }
                if (stale && res.data.isNotEmpty()) {
                    val rememberedId = runCatching { prefs.currentSpaceId.first() }.getOrNull()
                    _current.value = res.data.firstOrNull { it.id == rememberedId } ?: res.data.first()
                } else if (stale) {
                    _current.value = null
                }
            }
            is ApiResult.Failure -> Unit
        }
        _isLoading.value = false
    }
}
