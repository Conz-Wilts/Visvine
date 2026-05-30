package com.visvine.mobile.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Directory member — a Node row from /api/data/nodes, also reused for
 * /api/profile/[id]. Mirrors src/types/index.ts `DirectoryMember`. Note the
 * snake_case wire fields (`image_url`, `community_id`).
 */
@Serializable
data class DirectoryMember(
    val id: String,
    val name: String = "",
    val type: String = "person",
    val subtitle: String? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    val location: String? = null,
    val tags: List<String>? = null,
    @SerialName("community_id") val communityId: String? = null,
    val title: String? = null,
    val company: String? = null,
    val email: String? = null,
)

@Serializable
data class NodesResponse(
    val nodes: List<DirectoryMember> = emptyList(),
)

/** Partial profile patch sent by the edit screen (PATCH /api/profile/[id]). */
@Serializable
data class ProfileUpdate(
    val name: String? = null,
    val title: String? = null,
    val company: String? = null,
    val location: String? = null,
)
