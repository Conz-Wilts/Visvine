package com.visvine.mobile.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.visvine.mobile.auth.AuthManager
import com.visvine.mobile.data.model.DirectoryMember
import com.visvine.mobile.data.model.User
import com.visvine.mobile.data.remote.ApiResult
import com.visvine.mobile.data.repository.ProfileRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class ProfileViewModel @Inject constructor(
    private val profileRepo: ProfileRepository,
    private val authManager: AuthManager,
) : ViewModel() {

    data class State(
        val loading: Boolean = true,
        val profile: DirectoryMember? = null,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    val user: StateFlow<User?> = authManager.state
        .map { it.user }
        .stateIn(viewModelScope, SharingStarted.Eagerly, authManager.state.value.user)

    init {
        load()
    }

    private fun load() {
        val current = authManager.state.value.user
        if (current == null) {
            _state.value = State(loading = false)
            return
        }
        viewModelScope.launch {
            when (val res = profileRepo.getProfile(current.nodeId ?: current.id)) {
                is ApiResult.Success -> _state.value = State(loading = false, profile = res.data)
                is ApiResult.Failure -> _state.value = State(loading = false)
            }
        }
    }

    fun logout() = authManager.logout()
}
