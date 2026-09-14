package com.visvine.mobile.data.model

import kotlinx.serialization.Serializable

/** Rich profile — mirrors src/types/index.ts `FullProfile` (web /lib/profileTypes). */
@Serializable
data class FullProfile(
    val id: String,
    val spaceId: String? = null,
    val name: String = "",
    val subtitle: String? = null,
    val bio: String? = null,
    val location: String? = null,
    val website: String? = null,
    val linkedinUrl: String? = null,
    val twitterUrl: String? = null,
    val phone: String? = null,
    val pronouns: String? = null,
    val openToWork: Boolean = false,
    val email: String? = null,
    val imageUrl: String? = null,
    val tags: List<String> = emptyList(),
    val userId: String? = null,
    val createdAt: String = "",
    val updatedAt: String = "",
)
