package com.visvine.mobile.data.model

import kotlinx.serialization.Serializable

/**
 * Agent chat — mirrors lib/agents/chat.ts `ChatAgentRow` and
 * lib/agents/shared/chat.ts (`ChatMessageDto`, `ChatStreamEvent`). A thread is
 * the caller's standing conversation with one agent in one space.
 */
@Serializable
data class ChatThreadInfo(
    val lastMessageAt: String? = null,
    val lastPreview: String? = null,
    val unread: Boolean = false,
)

@Serializable
data class ChatAgentRow(
    val name: String,
    val title: String = "",
    val description: String? = null,
    /** A model can run it and the brief parses; `problem` says why not. */
    val ready: Boolean = false,
    val problem: String? = null,
    /** A turn is being answered right now on the caller's thread. */
    val answering: Boolean = false,
    val thread: ChatThreadInfo? = null,
)

/** GET /api/spaces/{spaceId}/agents/chat → `{ agents }`. */
@Serializable
data class ChatAgentsResponse(
    val agents: List<ChatAgentRow> = emptyList(),
)

/** One tool call of a turn as the message row keeps it. */
@Serializable
data class ChatTrace(
    val tool: String = "",
    val detail: String = "",
    val ok: Boolean = true,
)

@Serializable
data class ChatMessage(
    val id: String,
    /** `user` | `assistant`. */
    val role: String = "assistant",
    val text: String = "",
    /** `pending` | `done` | `failed`. */
    val status: String = "done",
    val reason: String? = null,
    val trace: List<ChatTrace> = emptyList(),
    val createdAt: String = "",
)

/** GET …/agents/{name}/chat → newest first, keyset `createdAt|id`. */
@Serializable
data class ChatPage(
    val messages: List<ChatMessage> = emptyList(),
    val nextCursor: String? = null,
)

@Serializable
data class ChatSendRequest(
    val text: String,
)

/** POST …/agents/{name}/chat → the stored question and the answer. */
@Serializable
data class ChatSendResponse(
    val userMessage: ChatMessage,
    val message: ChatMessage,
)

/**
 * One event off `POST …/chat/stream` — the `data: {"type": …}` lines of
 * `ChatStreamEvent`, parsed by `data/realtime/ChatEventParser.kt`.
 */
sealed interface ChatEvent {
    /** The stored question. */
    data class User(val message: ChatMessage) : ChatEvent

    /** A tool call the turn is making. */
    data class Tool(val tool: String, val detail: String) : ChatEvent

    /** What that call answered, clipped. */
    data class ToolResult(val tool: String, val text: String) : ChatEvent

    /** The answer's text as the model wrote it. */
    data class Assistant(val text: String) : ChatEvent

    /** The stored answer; the turn is over. */
    data class Done(val message: ChatMessage) : ChatEvent

    /** A refusal — `no_model`, `budget`, `busy`, `invalid_brief`, `rate`, `unknown_agent`, or the turn failing. */
    data class Error(val reason: String, val message: String) : ChatEvent
}
