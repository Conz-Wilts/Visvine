package com.visvine.mobile.data.model

import kotlinx.serialization.Serializable

@Serializable
data class MessageSender(
    val id: String,
    val name: String = "",
    val image: String? = null,
)

/** A single message. Server returns extra rich fields which are ignored. */
@Serializable
data class Message(
    val id: String,
    val text: String = "",
    val attachmentUrl: String? = null,
    val createdAt: String = "",
    val sender: MessageSender = MessageSender(id = ""),
    val isOwn: Boolean = false,
)

@Serializable
data class ConversationParticipant(
    val id: String,
    val name: String = "",
    val email: String = "",
    val image: String? = null,
    val role: String = "member",
    val lastReadAt: String? = null,
)

@Serializable
data class Conversation(
    val id: String,
    val type: String = "DM",
    val name: String = "",
    val avatarUrl: String? = null,
    val participants: List<ConversationParticipant> = emptyList(),
    val lastMessage: Message? = null,
    val unreadCount: Int = 0,
    val updatedAt: String = "",
)

@Serializable
data class ConversationsResponse(
    val conversations: List<Conversation> = emptyList(),
)

/** GET …/messages → cursor-paginated page. */
@Serializable
data class MessagesPage(
    val conversation: Conversation? = null,
    val messages: List<Message> = emptyList(),
    val nextCursor: String? = null,
    val hasMore: Boolean = false,
)

@Serializable
data class SendMessageRequest(
    val text: String,
)

/** POST /api/messages/conversations `{ userId }` — the DM with one person, made on first use. */
@Serializable
data class CreateDmRequest(
    val userId: String,
)

@Serializable
data class CreateDmResponse(
    val conversation: Conversation,
)

/** GET /api/messages/users?query= → people the caller may message (id, name, image only). */
@Serializable
data class UsersSearchResponse(
    val users: List<MessageSender> = emptyList(),
)
