package com.visvine.mobile.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.visvine.mobile.data.model.Event
import com.visvine.mobile.data.remote.ApiResult
import com.visvine.mobile.data.repository.EventsRepository
import com.visvine.mobile.ui.state.CommunityManager
import com.visvine.mobile.ui.state.SearchController
import com.visvine.mobile.ui.util.rankByQuery
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class EventsListViewModel @Inject constructor(
    private val eventsRepo: EventsRepository,
    private val communityManager: CommunityManager,
    private val search: SearchController,
) : ViewModel() {

    data class State(
        val loading: Boolean = true,
        val refreshing: Boolean = false,
        val error: String? = null,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    private val _events = MutableStateFlow<List<Event>>(emptyList())

    val filtered: StateFlow<List<Event>> =
        combine(_events, search.query) { events, q -> rankByQuery(events, q) { it.title } }
            .stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())

    init {
        viewModelScope.launch {
            // StateFlow already conflates equal values; an explicit
            // distinctUntilChanged() is a no-op the compiler rejects.
            communityManager.current.collect { load() }
        }
    }

    fun load() {
        val community = communityManager.current.value
        if (community == null) {
            _events.value = emptyList()
            _state.value = _state.value.copy(loading = false)
            return
        }
        _state.value = _state.value.copy(loading = true)
        viewModelScope.launch {
            applyResult(eventsRepo.getEvents(community.id))
            _state.value = _state.value.copy(loading = false)
        }
    }

    fun refresh() {
        val community = communityManager.current.value ?: return
        _state.value = _state.value.copy(refreshing = true)
        viewModelScope.launch {
            applyResult(eventsRepo.getEvents(community.id))
            _state.value = _state.value.copy(refreshing = false)
        }
    }

    private fun applyResult(res: ApiResult<List<Event>>) {
        when (res) {
            is ApiResult.Success -> {
                _events.value = res.data
                _state.value = _state.value.copy(error = null)
            }
            is ApiResult.Failure -> _state.value = _state.value.copy(error = res.error)
        }
    }
}
