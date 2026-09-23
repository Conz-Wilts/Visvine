package com.visvine.mobile.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.visvine.mobile.data.model.FeedPage
import com.visvine.mobile.data.model.FeedPost
import com.visvine.mobile.data.remote.ApiResult
import com.visvine.mobile.data.repository.FeedRepository
import com.visvine.mobile.ui.state.SpaceManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class HomeViewModel @Inject constructor(
    private val feedRepo: FeedRepository,
    private val spaceManager: SpaceManager,
) : ViewModel() {

    data class State(
        val spaceId: String? = null,
        val loading: Boolean = true,
        val refreshing: Boolean = false,
        val loadingMore: Boolean = false,
        val posts: List<FeedPost> = emptyList(),
        val nextCursor: String? = null,
        val error: String? = null,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            spaceManager.current.map { it?.id }.distinctUntilChanged().collect { spaceId ->
                _state.value = _state.value.copy(spaceId = spaceId, posts = emptyList(), nextCursor = null)
                load()
            }
        }
    }

    fun load() {
        val spaceId = _state.value.spaceId
        if (spaceId == null) {
            _state.value = _state.value.copy(loading = false, posts = emptyList(), nextCursor = null)
            return
        }
        _state.value = _state.value.copy(loading = true)
        viewModelScope.launch {
            applyFirstPage(spaceId, feedRepo.getFeed(spaceId, null))
            _state.value = _state.value.copy(loading = false)
        }
    }

    fun refresh() {
        val spaceId = _state.value.spaceId ?: return
        _state.value = _state.value.copy(refreshing = true)
        viewModelScope.launch {
            applyFirstPage(spaceId, feedRepo.getFeed(spaceId, null))
            _state.value = _state.value.copy(refreshing = false)
        }
    }

    fun loadMore() {
        val s = _state.value
        val spaceId = s.spaceId ?: return
        val cursor = s.nextCursor ?: return
        if (s.loadingMore || s.loading || s.refreshing) return
        _state.value = s.copy(loadingMore = true)
        viewModelScope.launch {
            when (val res = feedRepo.getFeed(spaceId, cursor)) {
                is ApiResult.Success -> {
                    // The space may have changed while the page was in flight.
                    if (_state.value.spaceId == spaceId) {
                        val seen = _state.value.posts.mapTo(HashSet()) { it.message.id }
                        _state.value = _state.value.copy(
                            posts = _state.value.posts + res.data.posts.filter { it.message.id !in seen },
                            nextCursor = res.data.nextCursor,
                        )
                    }
                }
                is ApiResult.Failure -> _state.value = _state.value.copy(error = res.error)
            }
            _state.value = _state.value.copy(loadingMore = false)
        }
    }

    private fun applyFirstPage(spaceId: String, res: ApiResult<FeedPage>) {
        if (_state.value.spaceId != spaceId) return
        when (res) {
            is ApiResult.Success -> _state.value = _state.value.copy(
                posts = res.data.posts,
                nextCursor = res.data.nextCursor,
                error = null,
            )
            is ApiResult.Failure -> _state.value = _state.value.copy(error = res.error)
        }
    }
}
