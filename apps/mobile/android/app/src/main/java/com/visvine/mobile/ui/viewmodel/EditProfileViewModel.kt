package com.visvine.mobile.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.visvine.mobile.auth.AuthManager
import com.visvine.mobile.data.model.ProfileUpdate
import com.visvine.mobile.data.remote.ApiResult
import com.visvine.mobile.data.repository.ProfileRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class EditProfileViewModel @Inject constructor(
    private val profileRepo: ProfileRepository,
    private val authManager: AuthManager,
) : ViewModel() {

    data class Form(
        val name: String = "",
        val title: String = "",
        val company: String = "",
        val location: String = "",
        val email: String = "",
    )

    data class State(
        val loading: Boolean = true,
        val saving: Boolean = false,
        val hasChanges: Boolean = false,
        val form: Form = Form(),
        val error: String? = null,
        val saved: Boolean = false,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    init {
        load()
    }

    private fun load() {
        val user = authManager.state.value.user
        if (user == null) {
            _state.value = _state.value.copy(loading = false)
            return
        }
        viewModelScope.launch {
            when (val res = profileRepo.getProfile(user.nodeId ?: user.id)) {
                is ApiResult.Success -> {
                    val m = res.data
                    _state.value = _state.value.copy(
                        loading = false,
                        form = Form(
                            name = m.name,
                            title = m.title ?: "",
                            company = m.company ?: "",
                            location = m.location ?: "",
                            email = user.email,
                        ),
                    )
                }
                is ApiResult.Failure -> _state.value = _state.value.copy(loading = false)
            }
        }
    }

    fun updateField(transform: (Form) -> Form) {
        _state.value = _state.value.copy(form = transform(_state.value.form), hasChanges = true)
    }

    fun save() {
        val user = authManager.state.value.user ?: return
        if (!_state.value.hasChanges) return
        _state.value = _state.value.copy(saving = true)
        val form = _state.value.form
        viewModelScope.launch {
            val res = profileRepo.updateProfile(
                user.id,
                ProfileUpdate(
                    name = form.name,
                    title = form.title,
                    company = form.company,
                    location = form.location,
                ),
            )
            when (res) {
                is ApiResult.Success ->
                    _state.value = _state.value.copy(saving = false, hasChanges = false, saved = true)
                is ApiResult.Failure ->
                    _state.value = _state.value.copy(saving = false, error = res.error)
            }
        }
    }

    fun consumeError() { _state.value = _state.value.copy(error = null) }
}
