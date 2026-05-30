package com.visvine.mobile.ui.viewmodel

import androidx.lifecycle.ViewModel
import com.visvine.mobile.ui.state.SearchController
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject

@HiltViewModel
class SearchViewModel @Inject constructor(
    private val searchController: SearchController,
) : ViewModel() {
    val query = searchController.query
    val isOpen = searchController.isOpen
    val placeholder = searchController.placeholder

    fun setQuery(value: String) = searchController.setQuery(value)
    fun setPlaceholder(value: String) = searchController.setPlaceholder(value)
    fun open() = searchController.open()
    fun close() = searchController.close()
}
