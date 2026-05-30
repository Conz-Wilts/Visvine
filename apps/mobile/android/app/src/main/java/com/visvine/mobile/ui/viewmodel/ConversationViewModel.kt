package com.visvine.mobile.ui.viewmodel

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.visvine.mobile.data.model.Message
import com.visvine.mobile.data.remote.ApiResult
import com.visvine.mobile.data.repository.MessagesRepository
import com.visvine.mobile.ui.navigation.Routes
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class ConversationViewModel @Inject constructor(
    private val messagesRepo: MessagesRepository,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {

    private val conversationId: String = checkNotNull(savedStateHandle[Routes.ARG_CONVERSATION_ID])

    data class State(
        val loading: Boolean = true,
        val messages: List<Message> = emptyList(),
        val sending: Boolean = false,
        val error: String? = null,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    init {
        load()
        observeRealtime()
    }

    private fun load() {
        viewModelScope.launch {
            when (val res = messagesRepo.getMessages(conversationId)) {
                is ApiResult.Success ->
                    // Server returns newest-first; reverse to chronological for the list.
                    _state.value = _state.value.copy(
                        loading = false,
                        messages = res.data.messages.reversed(),
                        error = null,
                    )
                is ApiResult.Failure ->
                    _state.value = _state.value.copy(loading = false, error = res.error)
            }
        }
    }

    /** Optimistic-send parity: clear input on the screen, restore on failure via [error]. */
    fun send(text: String, onInputRestore: (String) -> Unit) {
        if (text.isBlank() || _state.value.sending) return
        _state.value = _state.value.copy(sending = true)
        viewModelScope.launch {
            when (val res = messagesRepo.sendMessage(conversationId, text.trim())) {
                is ApiResult.Success ->
                    _state.value = _state.value.copy(
                        sending = false,
                        messages = _state.value.messages + res.data,
                    )
                is ApiResult.Failure -> {
                    _state.value = _state.value.copy(sending = false, error = res.error)
                    onInputRestore(text)
                }
            }
        }
    }

    private fun observeRealtime() {
        viewModelScope.launch {
            messagesRepo.realtimeEvents().collect { event ->
                if (event.conversationId == conversationId &&
                    (event.type == "message.new" || event.type == "message.updated" || event.type == "message.deleted")
                ) {
                    refreshMessages()
                }
            }
        }
    }

    private suspend fun refreshMessages() {
        when (val res = messagesRepo.getMessages(conversationId)) {
            is ApiResult.Success ->
                _state.value = _state.value.copy(messages = res.data.messages.reversed())
            is ApiResult.Failure -> Unit
        }
    }
}
