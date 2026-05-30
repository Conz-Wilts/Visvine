package com.visvine.mobile.data.model

import kotlinx.serialization.Serializable

/** Tenant community — mirrors docs/native-migration/api-contract.md `Community`. */
@Serializable
data class Community(
    val id: String,
    val name: String,
    val description: String? = null,
    val imageUrl: String? = null,
    val image: String? = null,
)

@Serializable
data class CommunitiesResponse(
    val communities: List<Community> = emptyList(),
)
