package com.visvine.mobile.data.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

/**
 * Activity — everything about the caller, in one row shape. Mirrors
 * lib/activity/shared/rows.ts `ActivityRow` and lib/activity/service.ts
 * `ActivityPage`. The `target` union is flattened: every key is optional and
 * `type` says which are set.
 */
@Serializable
data class ActivityActor(
    val id: String,
    val name: String = "",
    val image: String? = null,
)

@Serializable
data class ActivityTarget(
    /** `agent` | `conversation` | `members` | `accessRequests` | `event`. */
    val type: String = "",
    val spaceId: String? = null,
    val agentName: String? = null,
    val runId: String? = null,
    val conversationId: String? = null,
    val messageId: String? = null,
    val userId: String? = null,
    val requestId: String? = null,
    val eventId: String? = null,
)

/** A door that already exists — approve or decline through the member and access-request routes. */
@Serializable
data class ActivityAction(
    /** `Approve` | `Decline`. */
    val label: String = "",
    /** `PUT` | `DELETE`. */
    val method: String = "PUT",
    /** Absolute path under the API origin, e.g. `/api/notes/access-requests`. */
    val href: String = "",
    val body: JsonObject? = null,
)

@Serializable
data class ActivityRow(
    /** `<kind>:<source row id>` — stable, so a page never repeats one. */
    val id: String,
    /** `run` | `mention` | `reply` | `join_request` | `access_request` | `event`. */
    val kind: String = "",
    val at: String = "",
    val title: String = "",
    val subtitle: String? = null,
    val space: NamedRef? = null,
    val actor: ActivityActor? = null,
    val href: String = "",
    val target: ActivityTarget = ActivityTarget(),
    val actions: List<ActivityAction> = emptyList(),
)

/** GET /api/activity → `upcoming` on the first page only, `items` newest first. */
@Serializable
data class ActivityPage(
    val upcoming: List<ActivityRow> = emptyList(),
    val items: List<ActivityRow> = emptyList(),
    val nextCursor: String? = null,
)
