package com.visvine.mobile.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.visvine.mobile.data.model.ChatAgentRow
import com.visvine.mobile.data.remote.ApiResult
import com.visvine.mobile.data.repository.AgentsRepository
import com.visvine.mobile.ui.state.SpaceManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import javax.inject.Inject

/** The space's agents as standing threads — the Agents segment of Messages. */
@HiltViewModel
class AgentsViewModel @Inject constructor(
    private val agentsRepo: AgentsRepository,
    private val spaceManager: SpaceManager,
) : ViewModel() {

    data class State(
        val spaceId: String? = null,
        val loading: Boolean = true,
        val refreshing: Boolean = false,
        val agents: List<ChatAgentRow> = emptyList(),
        val error: String? = null,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            spaceManager.current.map { it?.id }.distinctUntilChanged().collect { spaceId ->
                _state.value = _state.value.copy(spaceId = spaceId, agents = emptyList())
                load()
            }
        }
    }

    fun load() {
        val spaceId = _state.value.spaceId
        if (spaceId == null) {
            _state.value = _state.value.copy(loading = false, agents = emptyList())
            return
        }
        _state.value = _state.value.copy(loading = true)
        viewModelScope.launch {
            apply(spaceId, agentsRepo.listAgents(spaceId))
            _state.value = _state.value.copy(loading = false)
        }
    }

    /** Pull-to-refresh, and the quiet re-read on resume (a thread may have moved on). */
    fun refresh(quiet: Boolean = false) {
        val spaceId = _state.value.spaceId ?: return
        if (quiet && _state.value.loading) return
        if (!quiet) _state.value = _state.value.copy(refreshing = true)
        viewModelScope.launch {
            apply(spaceId, agentsRepo.listAgents(spaceId))
            if (!quiet) _state.value = _state.value.copy(refreshing = false)
        }
    }

    private fun apply(spaceId: String, res: ApiResult<List<ChatAgentRow>>) {
        if (_state.value.spaceId != spaceId) return
        when (res) {
            is ApiResult.Success -> _state.value = _state.value.copy(agents = res.data, error = null)
            is ApiResult.Failure -> _state.value = _state.value.copy(error = res.error)
        }
    }
}
