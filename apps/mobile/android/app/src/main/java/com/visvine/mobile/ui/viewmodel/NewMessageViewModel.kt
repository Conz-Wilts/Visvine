package com.visvine.mobile.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.visvine.mobile.data.model.MessageSender
import com.visvine.mobile.data.remote.ApiResult
import com.visvine.mobile.data.repository.MessagesRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import javax.inject.Inject

/** The person picker a new DM starts from: a search, then the DM made on first use. */
@OptIn(FlowPreview::class)
@HiltViewModel
class NewMessageViewModel @Inject constructor(
    private val messagesRepo: MessagesRepository,
) : ViewModel() {

    data class State(
        val loading: Boolean = false,
        val users: List<MessageSender> = emptyList(),
        val error: String? = null,
        /** The id of the person whose DM is being made — the row shows a spinner. */
        val opening: String? = null,
    )

    private val _query = MutableStateFlow("")
    val query: StateFlow<String> = _query.asStateFlow()

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            _query.debounce(250).distinctUntilChanged().collect { q -> search(q) }
        }
    }

    fun setQuery(value: String) {
        _query.value = value
    }

    private suspend fun search(q: String) {
        _state.value = _state.value.copy(loading = true)
        when (val res = messagesRepo.searchUsers(q)) {
            is ApiResult.Success -> _state.value = _state.value.copy(loading = false, users = res.data, error = null)
            is ApiResult.Failure -> _state.value = _state.value.copy(loading = false, error = res.error)
        }
    }

    fun open(user: MessageSender, onOpened: (conversationId: String, name: String) -> Unit) {
        if (_state.value.opening != null) return
        _state.value = _state.value.copy(opening = user.id, error = null)
        viewModelScope.launch {
            when (val res = messagesRepo.createDm(user.id)) {
                is ApiResult.Success -> {
                    _state.value = _state.value.copy(opening = null)
                    onOpened(res.data.id, user.name.ifBlank { res.data.name })
                }
                is ApiResult.Failure -> _state.value = _state.value.copy(opening = null, error = res.error)
            }
        }
    }
}
