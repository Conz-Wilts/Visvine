package com.visvine.mobile.data.model

import kotlinx.serialization.Serializable

/** Authenticated user — mirrors src/types/index.ts `User`. */
@Serializable
data class User(
    val id: String,
    val name: String = "",
    val email: String = "",
    val image: String? = null,
    val nodeId: String? = null,
    val isSuperAdmin: Boolean? = null,
)

/** GET /api/auth/session → { session: { user } | null }. */
@Serializable
data class SessionResponse(
    val session: SessionPayload? = null,
)

@Serializable
data class SessionPayload(
    val user: User? = null,
)

/** A seeded user offered by the dev-login path (GET /api/dev/list-users). */
@Serializable
data class DevUser(
    val id: String,
    val name: String,
    val email: String,
    val image: String? = null,
)

@Serializable
data class DevUsersResponse(
    val users: List<DevUser> = emptyList(),
)

@Serializable
data class IssueTokenRequest(
    val userId: String,
)

@Serializable
data class IssueTokenResponse(
    val token: String,
    val user: DevUser,
)
