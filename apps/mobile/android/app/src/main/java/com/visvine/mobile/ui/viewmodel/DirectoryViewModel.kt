package com.visvine.mobile.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.visvine.mobile.data.model.DirectoryMember
import com.visvine.mobile.data.remote.ApiResult
import com.visvine.mobile.data.repository.DirectoryRepository
import com.visvine.mobile.ui.state.SpaceManager
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

enum class SortOrder { AZ, ZA }

@HiltViewModel
class DirectoryViewModel @Inject constructor(
    private val directoryRepo: DirectoryRepository,
    private val spaceManager: SpaceManager,
    private val search: SearchController,
) : ViewModel() {

    data class State(
        val loading: Boolean = true,
        val refreshing: Boolean = false,
        val error: String? = null,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    private val _members = MutableStateFlow<List<DirectoryMember>>(emptyList())

    private val _selectedTypes = MutableStateFlow<Set<String>>(emptySet())
    val selectedTypes: StateFlow<Set<String>> = _selectedTypes.asStateFlow()

    private val _selectedTags = MutableStateFlow<Set<String>>(emptySet())
    val selectedTags: StateFlow<Set<String>> = _selectedTags.asStateFlow()

    private val _sortOrder = MutableStateFlow(SortOrder.AZ)
    val sortOrder: StateFlow<SortOrder> = _sortOrder.asStateFlow()

    val query: StateFlow<String> = search.query

    val presentTypes: StateFlow<List<String>> = _members
        .map { list -> list.map { it.type }.toSortedSet().toList() }
        .stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())

    val presentTags: StateFlow<List<String>> = _members
        .map { list -> list.flatMap { it.tags ?: emptyList() }.toSortedSet().toList() }
        .stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())

    /** Replicates DirectoryScreen.filteredMembers exactly. */
    val filtered: StateFlow<List<DirectoryMember>> =
        combine(_members, _selectedTypes, _selectedTags, _sortOrder, search.query) { members, types, tags, sort, q ->
            var result = if (types.isNotEmpty()) {
                members.filter { it.type in types }
            } else {
                members.filter { it.type.lowercase() == "person" }
            }
            if (tags.isNotEmpty()) {
                result = result.filter { (it.tags ?: emptyList()).any { t -> t in tags } }
            }
            val needle = q.trim().lowercase()
            if (needle.isNotEmpty()) {
                result
                    .map { it to searchScore(needle, it.name) }
                    .filter { it.second > 0 }
                    .sortedByDescending { it.second }
                    .map { it.first }
            } else {
                result.sortedWith(
                    if (sort == SortOrder.AZ) compareBy { it.name }
                    else compareByDescending { it.name }
                )
            }
        }.stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())

    val hasFilters: StateFlow<Boolean> =
        combine(_selectedTypes, _selectedTags, _sortOrder) { types, tags, sort ->
            types.isNotEmpty() || tags.isNotEmpty() || sort != SortOrder.AZ
        }.stateIn(viewModelScope, SharingStarted.Eagerly, false)

    init {
        viewModelScope.launch {
            // StateFlow already conflates equal values; an explicit
            // distinctUntilChanged() is a no-op the compiler rejects.
            spaceManager.current.collect { load() }
        }
    }

    fun load() {
        val space = spaceManager.current.value
        if (space == null) {
            _members.value = emptyList()
            _state.value = _state.value.copy(loading = false)
            return
        }
        _state.value = _state.value.copy(loading = true)
        viewModelScope.launch {
            applyResult(directoryRepo.getMembers(space.id))
            _state.value = _state.value.copy(loading = false)
        }
    }

    fun refresh() {
        val space = spaceManager.current.value ?: return
        _state.value = _state.value.copy(refreshing = true)
        viewModelScope.launch {
            applyResult(directoryRepo.getMembers(space.id))
            _state.value = _state.value.copy(refreshing = false)
        }
    }

    private fun applyResult(res: ApiResult<List<DirectoryMember>>) {
        when (res) {
            is ApiResult.Success -> {
                _members.value = res.data
                _state.value = _state.value.copy(error = null)
            }
            is ApiResult.Failure -> _state.value = _state.value.copy(error = res.error)
        }
    }

    fun toggleType(value: String) = _selectedTypes.update(value)
    fun toggleTag(value: String) = _selectedTags.update(value)
    fun clearTypes() { _selectedTypes.value = emptySet() }
    fun clearTags() { _selectedTags.value = emptySet() }
    fun toggleSort() { _sortOrder.value = if (_sortOrder.value == SortOrder.AZ) SortOrder.ZA else SortOrder.AZ }
    fun clearFilters() {
        _selectedTypes.value = emptySet()
        _selectedTags.value = emptySet()
        _sortOrder.value = SortOrder.AZ
    }

    private fun MutableStateFlow<Set<String>>.update(value: String) {
        this.value = this.value.toMutableSet().apply { if (!add(value)) remove(value) }
    }
}
