package com.visvine.mobile.ui.state

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Shared search state for the tab area — the native equivalent of SearchContext.
 * The glass tab bar's search button opens the overlay; each tab sets its own
 * placeholder on focus and reads [query] to filter.
 */
@Singleton
class SearchController @Inject constructor() {
    private val _query = MutableStateFlow("")
    val query: StateFlow<String> = _query.asStateFlow()

    private val _isOpen = MutableStateFlow(false)
    val isOpen: StateFlow<Boolean> = _isOpen.asStateFlow()

    private val _placeholder = MutableStateFlow("Search")
    val placeholder: StateFlow<String> = _placeholder.asStateFlow()

    fun setQuery(value: String) { _query.value = value }
    fun setPlaceholder(value: String) { _placeholder.value = value }
    fun open() { _isOpen.value = true }
    fun close() {
        _isOpen.value = false
        _query.value = ""
    }
}
