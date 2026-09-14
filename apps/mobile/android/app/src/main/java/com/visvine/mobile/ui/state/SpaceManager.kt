package com.visvine.mobile.ui.state

import com.visvine.mobile.auth.AuthManager
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
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/**
 * App-scoped space selection — the native equivalent of SpaceProvider.
 * Refreshes when the user becomes authenticated and clears on sign-out; the
 * first space is selected by default.
 */
@Singleton
class SpaceManager @Inject constructor(
    authManager: AuthManager,
    private val spaceRepo: SpaceRepository,
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
    }

    suspend fun refresh() {
        _isLoading.value = true
        when (val res = spaceRepo.getSpaces()) {
            is ApiResult.Success -> {
                _spaces.value = res.data
                if (_current.value == null && res.data.isNotEmpty()) {
                    _current.value = res.data.first()
                }
            }
            is ApiResult.Failure -> Unit
        }
        _isLoading.value = false
    }
}
