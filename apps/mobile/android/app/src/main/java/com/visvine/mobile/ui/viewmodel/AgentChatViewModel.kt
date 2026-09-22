package com.visvine.mobile.ui.viewmodel

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.visvine.mobile.data.model.ChatEvent
import com.visvine.mobile.data.model.ChatMessage
import com.visvine.mobile.data.remote.ApiResult
import com.visvine.mobile.data.repository.AgentsRepository
import com.visvine.mobile.ui.navigation.Routes
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.onCompletion
import kotlinx.coroutines.launch
import java.time.Instant
import javax.inject.Inject

/**
 * One thread with one agent. History is read newest-first and kept
 * chronological; a send streams the turn (docs/mobile.md § Agent chat) and
 * the stored answer lands when `done` arrives. A stream that closes without
 * `done` re-reads the thread, because the turn is never tied to the response.
 */
@HiltViewModel
class AgentChatViewModel @Inject constructor(
    private val agentsRepo: AgentsRepository,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {

    val spaceId: String = checkNotNull(savedStateHandle[Routes.ARG_SPACE_ID])
    val agentName: String = checkNotNull(savedStateHandle[Routes.ARG_AGENT_NAME])

    data class State(
        val loading: Boolean = true,
        val messages: List<ChatMessage> = emptyList(),
        /** Cursor for the page OLDER than the first message held. */
        val olderCursor: String? = null,
        val loadingOlder: Boolean = false,
        val sending: Boolean = false,
        /** "Working… <tool> <detail>" while a turn runs and nothing has been said yet. */
        val working: String? = null,
        /** The answer as the model writes it, before `done` stores it. */
        val live: String? = null,
        val error: String? = null,
        /** Why the agent cannot answer, when the roster says it is not ready. */
        val problem: String? = null,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    private var sendJob: Job? = null

    init {
        load()
        readiness()
    }

    private fun load() {
        viewModelScope.launch {
            when (val res = agentsRepo.getMessages(spaceId, agentName)) {
                is ApiResult.Success -> _state.value = _state.value.copy(
                    loading = false,
                    messages = res.data.messages.reversed(),
                    olderCursor = res.data.nextCursor,
                    error = null,
                )
                is ApiResult.Failure -> _state.value = _state.value.copy(loading = false, error = res.error)
            }
        }
    }

    private fun readiness() {
        viewModelScope.launch {
            when (val res = agentsRepo.listAgents(spaceId)) {
                is ApiResult.Success -> {
                    val row = res.data.firstOrNull { it.name == agentName }
                    _state.value = _state.value.copy(problem = row?.takeIf { !it.ready }?.problem)
                }
                is ApiResult.Failure -> Unit
            }
        }
    }

    fun loadOlder() {
        val s = _state.value
        val cursor = s.olderCursor ?: return
        if (s.loadingOlder || s.loading) return
        _state.value = s.copy(loadingOlder = true)
        viewModelScope.launch {
            when (val res = agentsRepo.getMessages(spaceId, agentName, cursor)) {
                is ApiResult.Success -> {
                    val held = _state.value.messages.mapTo(HashSet()) { it.id }
                    val older = res.data.messages.reversed().filter { it.id !in held }
                    _state.value = _state.value.copy(
                        messages = older + _state.value.messages,
                        olderCursor = res.data.nextCursor,
                        loadingOlder = false,
                    )
                }
                is ApiResult.Failure -> _state.value = _state.value.copy(loadingOlder = false, error = res.error)
            }
        }
    }

    /** One message: an own bubble at once, then the turn as it streams. */
    fun send(text: String, onInputRestore: (String) -> Unit) {
        val trimmed = text.trim()
        if (trimmed.isEmpty() || _state.value.sending) return
        val localId = "local-${System.currentTimeMillis()}"
        val optimistic = ChatMessage(
            id = localId,
            role = "user",
            text = trimmed,
            status = "pending",
            createdAt = Instant.now().toString(),
        )
        _state.value = _state.value.copy(
            sending = true,
            error = null,
            working = "Working…",
            live = null,
            messages = _state.value.messages + optimistic,
        )
        var stored = false
        var finished = false
        sendJob = viewModelScope.launch {
            agentsRepo.send(spaceId, agentName, trimmed)
                .catch { t -> _state.value = _state.value.copy(error = t.message ?: "Connection lost") }
                .onCompletion {
                    if (!finished) {
                        // The stream ended before `done` — the turn may still have
                        // finished on the server; its answer is on the thread.
                        if (stored) refreshThread()
                        else _state.value = _state.value.copy(messages = _state.value.messages.filterNot { it.id == localId })
                        _state.value = _state.value.copy(sending = false, working = null, live = null)
                    }
                }
                .collect { event ->
                    when (event) {
                        is ChatEvent.User -> {
                            stored = true
                            _state.value = _state.value.copy(
                                messages = _state.value.messages.map { if (it.id == localId) event.message else it },
                            )
                        }
                        is ChatEvent.Tool -> _state.value = _state.value.copy(
                            working = "Working… ${event.tool} ${event.detail}".trimEnd(),
                        )
                        is ChatEvent.ToolResult -> Unit
                        is ChatEvent.Assistant -> _state.value = _state.value.copy(live = event.text, working = null)
                        is ChatEvent.Done -> {
                            finished = true
                            _state.value = _state.value.copy(
                                sending = false,
                                working = null,
                                live = null,
                                messages = _state.value.messages.filterNot { it.id == event.message.id } + event.message,
                            )
                        }
                        is ChatEvent.Error -> {
                            finished = true
                            val messages = if (stored) _state.value.messages
                            else _state.value.messages.filterNot { it.id == localId }
                            _state.value = _state.value.copy(
                                sending = false,
                                working = null,
                                live = null,
                                error = event.message.ifBlank { "The turn failed." },
                                messages = messages,
                            )
                            if (!stored) onInputRestore(trimmed)
                        }
                    }
                }
        }
    }

    fun clear() {
        sendJob?.cancel()
        viewModelScope.launch {
            when (val res = agentsRepo.clear(spaceId, agentName)) {
                is ApiResult.Success -> _state.value = _state.value.copy(
                    messages = emptyList(),
                    olderCursor = null,
                    sending = false,
                    working = null,
                    live = null,
                    error = null,
                )
                is ApiResult.Failure -> _state.value = _state.value.copy(error = res.error)
            }
        }
    }

    private suspend fun refreshThread() {
        when (val res = agentsRepo.getMessages(spaceId, agentName)) {
            is ApiResult.Success -> {
                val page = res.data.messages.reversed()
                val pageIds = page.mapTo(HashSet()) { it.id }
                // Keep what was paged in above the first page; replace the rest.
                val olderHeld = _state.value.messages.filter { it.id !in pageIds && !it.id.startsWith("local-") }
                val firstOnPage = page.firstOrNull()?.createdAt
                val kept = if (firstOnPage == null) emptyList() else olderHeld.filter { it.createdAt < firstOnPage }
                _state.value = _state.value.copy(messages = kept + page)
            }
            is ApiResult.Failure -> Unit
        }
    }
}
