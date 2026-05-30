package com.visvine.mobile.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.visvine.mobile.auth.AuthManager
import com.visvine.mobile.data.model.DevUser
import com.visvine.mobile.data.model.User
import com.visvine.mobile.data.remote.ApiResult
import com.visvine.mobile.data.repository.AuthRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class DevLoginViewModel @Inject constructor(
    private val authRepo: AuthRepository,
    private val authManager: AuthManager,
) : ViewModel() {

    data class State(
        val loading: Boolean = true,
        val users: List<DevUser> = emptyList(),
        val signingInId: String? = null,
        val error: String? = null,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    init {
        load()
    }

    private fun load() {
        viewModelScope.launch {
            when (val res = authRepo.listDevUsers()) {
                is ApiResult.Success -> _state.value = State(loading = false, users = res.data)
                is ApiResult.Failure -> _state.value = State(loading = false, error = res.error)
            }
        }
    }

    fun signInAs(user: DevUser) {
        _state.value = _state.value.copy(signingInId = user.id, error = null)
        viewModelScope.launch {
            when (val res = authRepo.issueDevToken(user.id)) {
                is ApiResult.Success -> {
                    val u = res.data.user
                    authManager.setUser(
                        User(id = u.id, name = u.name, email = u.email, image = u.image),
                        res.data.token,
                    )
                }
                is ApiResult.Failure ->
                    _state.value = _state.value.copy(signingInId = null, error = res.error)
            }
        }
    }

    fun consumeError() {
        _state.value = _state.value.copy(error = null)
    }
}
