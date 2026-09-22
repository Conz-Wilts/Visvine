package com.visvine.mobile.data.model

import kotlinx.serialization.Serializable

/** Tenant space — mirrors the web API's `Space` DTO (server truth). */
@Serializable
data class Space(
    val id: String,
    val name: String,
    val description: String? = null,
    val imageUrl: String? = null,
    val image: String? = null,
    /** The house this space is a room of; null for a top-level space. */
    val parentId: String? = null,
)

@Serializable
data class SpacesResponse(
    val spaces: List<Space> = emptyList(),
)
