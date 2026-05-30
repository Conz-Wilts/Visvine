package com.visvine.mobile.ui.viewmodel

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.visvine.mobile.data.model.Event
import com.visvine.mobile.data.remote.ApiResult
import com.visvine.mobile.data.repository.EventsRepository
import com.visvine.mobile.ui.navigation.Routes
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class EventDetailViewModel @Inject constructor(
    private val eventsRepo: EventsRepository,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {

    private val eventId: String = checkNotNull(savedStateHandle[Routes.ARG_EVENT_ID])

    data class State(
        val loading: Boolean = true,
        val event: Event? = null,
        val error: String? = null,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    init {
        load()
    }

    fun load() {
        _state.value = State(loading = true)
        viewModelScope.launch {
            when (val res = eventsRepo.getEvent(eventId)) {
                is ApiResult.Success -> _state.value = State(loading = false, event = res.data)
                is ApiResult.Failure -> _state.value = State(loading = false, error = res.error)
            }
        }
    }
}
