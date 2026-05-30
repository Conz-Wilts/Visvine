package com.visvine.mobile.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.visvine.mobile.auth.AuthManager
import com.visvine.mobile.data.model.Conversation
import com.visvine.mobile.data.remote.ApiResult
import com.visvine.mobile.data.repository.MessagesRepository
import com.visvine.mobile.ui.state.SearchController
import com.visvine.mobile.ui.util.searchScore
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class ConversationsViewModel @Inject constructor(
    private val messagesRepo: MessagesRepository,
    private val authManager: AuthManager,
    private val search: SearchController,
) : ViewModel() {

    data class State(
        val loading: Boolean = true,
        val refreshing: Boolean = false,
        val error: String? = null,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    private val _conversations = MutableStateFlow<List<Conversation>>(emptyList())

    val currentUserId: StateFlow<String?> = authManager.state
        .map { it.user?.id }
        .stateIn(viewModelScope, SharingStarted.Eagerly, null)

    val query: StateFlow<String> = search.query

    val filtered: StateFlow<List<Conversation>> =
        combine(_conversations, search.query, currentUserId) { convos, q, uid ->
            val needle = q.trim().lowercase()
            if (needle.isEmpty()) convos
            else convos
                .map { it to searchScore(needle, displayName(it, uid)) }
                .filter { it.second > 0 }
                .sortedByDescending { it.second }
                .map { it.first }
        }.stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())

    init {
        load()
        observeRealtime()
    }

    fun displayName(c: Conversation, userId: String?): String {
        val other = c.participants.firstOrNull { it.id != userId }
        return if (c.type == "GROUP") c.name else other?.name ?: "Unknown"
    }

    fun load() {
        _state.value = _state.value.copy(loading = true)
        viewModelScope.launch {
            applyResult(messagesRepo.getConversations())
            _state.value = _state.value.copy(loading = false)
        }
    }

    fun refresh() {
        _state.value = _state.value.copy(refreshing = true)
        viewModelScope.launch {
            applyResult(messagesRepo.getConversations())
            _state.value = _state.value.copy(refreshing = false)
        }
    }

    private fun observeRealtime() {
        viewModelScope.launch {
            messagesRepo.realtimeEvents().collect { event ->
                // Any new message / conversation change refreshes the list ordering.
                if (event.type == "message.new" || event.type == "conversation.updated") {
                    applyResult(messagesRepo.getConversations())
                }
            }
        }
    }

    private fun applyResult(res: ApiResult<List<Conversation>>) {
        when (res) {
            is ApiResult.Success -> {
                _conversations.value = res.data
                _state.value = _state.value.copy(error = null)
            }
            is ApiResult.Failure -> _state.value = _state.value.copy(error = res.error)
        }
    }
}
