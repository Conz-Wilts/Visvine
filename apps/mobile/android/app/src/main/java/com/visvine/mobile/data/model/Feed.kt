package com.visvine.mobile.data.model

import kotlinx.serialization.Serializable

/** An `{ id, name }` reference — a channel or a space, named for a row. */
@Serializable
data class NamedRef(
    val id: String,
    val name: String = "",
)

/** Where a post was written — mirrors lib/messages/shared/feed.ts `FeedPlace`. */
@Serializable
data class FeedPlace(
    val conversationId: String,
    val channel: NamedRef = NamedRef(id = ""),
    val space: NamedRef = NamedRef(id = ""),
)

/** A post and its comments — mirrors `FeedPost`. */
@Serializable
data class FeedPost(
    val conversationId: String,
    val channel: NamedRef = NamedRef(id = ""),
    val space: NamedRef = NamedRef(id = ""),
    val message: Message,
    val comments: List<Message> = emptyList(),
)

/** GET /api/feed → keyset page, newest first; `targets` on the first page only. */
@Serializable
data class FeedPage(
    val posts: List<FeedPost> = emptyList(),
    val nextCursor: String? = null,
    val targets: List<FeedPlace>? = null,
)
