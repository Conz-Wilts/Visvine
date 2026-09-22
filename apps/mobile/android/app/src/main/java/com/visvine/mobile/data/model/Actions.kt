package com.visvine.mobile.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

/**
 * Action inputs — `POST /api/actions/<name>`, the body being the action's own
 * Zod input, which is why these are snake_case where every other route is
 * camelCase. The answer is `{ result }`.
 */
@Serializable
data class EditContextRequest(
    @SerialName("space_id") val spaceId: String,
    val path: String,
    val content: String,
)

@Serializable
data class AddContextRequest(
    @SerialName("space_id") val spaceId: String,
    /** `person` | `space` | `resource`. */
    val type: String,
    val name: String,
    val body: String? = null,
)

@Serializable
data class ActionEnvelope<T>(
    val result: T,
)

@Serializable
data class EditContextResult(
    val status: String = "",
    val path: String = "",
)

/** `add_context` answers the node and note it made; the composer reads none of it. */
typealias AddContextResult = JsonObject
