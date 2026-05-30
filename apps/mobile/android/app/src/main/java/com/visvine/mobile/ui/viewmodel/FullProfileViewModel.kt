package com.visvine.mobile.ui.viewmodel

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.visvine.mobile.auth.AuthManager
import com.visvine.mobile.data.model.FullProfile
import com.visvine.mobile.data.remote.ApiResult
import com.visvine.mobile.data.repository.ProfileRepository
import com.visvine.mobile.ui.navigation.Routes
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class FullProfileViewModel @Inject constructor(
    private val profileRepo: ProfileRepository,
    authManager: AuthManager,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {

    private val personId: String = checkNotNull(savedStateHandle[Routes.ARG_PERSON_ID])

    val isOwner: Boolean = authManager.state.value.user?.nodeId
        ?.let { it == personId } ?: false

    data class State(
        val loading: Boolean = true,
        val refreshing: Boolean = false,
        val profile: FullProfile? = null,
        val error: String? = null,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    init {
        load()
    }

    fun load() {
        _state.value = _state.value.copy(loading = true)
        viewModelScope.launch {
            applyResult(profileRepo.getFullProfile(personId))
            _state.value = _state.value.copy(loading = false)
        }
    }

    fun refresh() {
        _state.value = _state.value.copy(refreshing = true)
        viewModelScope.launch {
            applyResult(profileRepo.getFullProfile(personId))
            _state.value = _state.value.copy(refreshing = false)
        }
    }

    private fun applyResult(res: ApiResult<FullProfile>) {
        when (res) {
            is ApiResult.Success -> _state.value = _state.value.copy(profile = res.data, error = null)
            is ApiResult.Failure -> _state.value = _state.value.copy(profile = null, error = res.error)
        }
    }
}
