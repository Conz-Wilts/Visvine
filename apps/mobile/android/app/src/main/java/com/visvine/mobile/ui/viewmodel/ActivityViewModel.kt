package com.visvine.mobile.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.visvine.mobile.data.model.ActivityAction
import com.visvine.mobile.data.model.ActivityPage
import com.visvine.mobile.data.model.ActivityRow
import com.visvine.mobile.data.remote.ApiResult
import com.visvine.mobile.data.repository.ActivityRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/** Everything about the caller, newest first, with the requests they can answer. */
@HiltViewModel
class ActivityViewModel @Inject constructor(
    private val activityRepo: ActivityRepository,
) : ViewModel() {

    data class State(
        val loading: Boolean = true,
        val refreshing: Boolean = false,
        val loadingMore: Boolean = false,
        val upcoming: List<ActivityRow> = emptyList(),
        val items: List<ActivityRow> = emptyList(),
        val nextCursor: String? = null,
        val error: String? = null,
        /** Row id → "Approved" | "Declined", once its door has been answered. */
        val decided: Map<String, String> = emptyMap(),
        /** Row ids whose decision is in flight. */
        val deciding: Set<String> = emptySet(),
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    init {
        load()
    }

    fun load() {
        _state.value = _state.value.copy(loading = true)
        viewModelScope.launch {
            applyFirstPage(activityRepo.list(null))
            _state.value = _state.value.copy(loading = false)
        }
    }

    fun refresh() {
        _state.value = _state.value.copy(refreshing = true)
        viewModelScope.launch {
            applyFirstPage(activityRepo.list(null))
            _state.value = _state.value.copy(refreshing = false)
        }
    }

    fun loadMore() {
        val s = _state.value
        val cursor = s.nextCursor ?: return
        if (s.loadingMore || s.loading || s.refreshing) return
        _state.value = s.copy(loadingMore = true)
        viewModelScope.launch {
            when (val res = activityRepo.list(cursor)) {
                is ApiResult.Success -> {
                    val seen = _state.value.items.mapTo(HashSet()) { it.id }
                    _state.value = _state.value.copy(
                        items = _state.value.items + res.data.items.filter { it.id !in seen },
                        nextCursor = res.data.nextCursor,
                    )
                }
                is ApiResult.Failure -> _state.value = _state.value.copy(error = res.error)
            }
            _state.value = _state.value.copy(loadingMore = false)
        }
    }

    /** Answer a request through the door the row named; the row then says which. */
    fun decide(row: ActivityRow, action: ActivityAction) {
        if (row.id in _state.value.deciding || row.id in _state.value.decided) return
        _state.value = _state.value.copy(deciding = _state.value.deciding + row.id, error = null)
        viewModelScope.launch {
            val verdict = if (action.label.equals("Decline", ignoreCase = true)) "Declined" else "Approved"
            when (val res = activityRepo.decide(action)) {
                is ApiResult.Success -> _state.value = _state.value.copy(
                    decided = _state.value.decided + (row.id to verdict),
                    deciding = _state.value.deciding - row.id,
                )
                is ApiResult.Failure -> _state.value = _state.value.copy(
                    deciding = _state.value.deciding - row.id,
                    error = res.error,
                )
            }
        }
    }

    private fun applyFirstPage(res: ApiResult<ActivityPage>) {
        when (res) {
            is ApiResult.Success -> _state.value = _state.value.copy(
                upcoming = res.data.upcoming,
                items = res.data.items,
                nextCursor = res.data.nextCursor,
                error = null,
            )
            is ApiResult.Failure -> _state.value = _state.value.copy(error = res.error)
        }
    }
}
