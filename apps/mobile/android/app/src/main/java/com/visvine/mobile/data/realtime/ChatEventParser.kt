package com.visvine.mobile.data.realtime

import com.visvine.mobile.data.model.ChatEvent
import com.visvine.mobile.data.model.ChatMessage
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * One `data:` line of `POST …/agents/<name>/chat/stream` → a [ChatEvent], or
 * null for a type this client does not know or a payload that does not parse.
 * Pure — the stream and the test both call it. The server names the event in
 * the JSON's `type` field, never in an SSE `event:` line
 * (lib/agents/shared/chat.ts#ChatStreamEvent).
 */
fun parseChatEvent(json: Json, data: String): ChatEvent? {
    val obj = sseDataObject(json, data) ?: return null
    val type = obj.string("type") ?: return null
    return runCatching {
        when (type) {
            "user" -> ChatEvent.User(obj.message(json) ?: return null)
            "tool" -> ChatEvent.Tool(tool = obj.string("tool") ?: "", detail = obj.string("detail") ?: "")
            "tool_result" -> ChatEvent.ToolResult(tool = obj.string("tool") ?: "", text = obj.string("text") ?: "")
            "assistant" -> ChatEvent.Assistant(text = obj.string("text") ?: "")
            "done" -> ChatEvent.Done(obj.message(json) ?: return null)
            "error" -> ChatEvent.Error(reason = obj.string("reason") ?: "error", message = obj.string("message") ?: "")
            else -> null
        }
    }.getOrNull()
}

private fun JsonObject.string(key: String): String? =
    runCatching { this[key]?.jsonPrimitive?.content }.getOrNull()

private fun JsonObject.message(json: Json): ChatMessage? =
    runCatching { json.decodeFromJsonElement(ChatMessage.serializer(), this["message"]!!.jsonObject) }.getOrNull()
