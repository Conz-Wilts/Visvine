package com.visvine.mobile.data.repository

import com.visvine.mobile.core.AppConfig
import com.visvine.mobile.data.model.ChatAgentRow
import com.visvine.mobile.data.model.ChatEvent
import com.visvine.mobile.data.model.ChatPage
import com.visvine.mobile.data.model.ChatSendRequest
import com.visvine.mobile.data.realtime.parseChatEvent
import com.visvine.mobile.data.realtime.sseDataObject
import com.visvine.mobile.data.remote.ApiResult
import com.visvine.mobile.data.remote.VisvineApi
import com.visvine.mobile.data.remote.safeApiCall
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources
import java.net.URLEncoder
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Agent chat — the space's agents as standing threads (docs/mobile.md § Agent
 * chat). Reads and the clear go through Retrofit; a send is the SSE form,
 * hand-rolled over OkHttp like [com.visvine.mobile.data.realtime.MessageStream]
 * because a POST with a body is not something the browser EventSource shape
 * allows and OkHttp's does.
 */
@Singleton
class AgentsRepository @Inject constructor(
    private val api: VisvineApi,
    private val client: OkHttpClient,
    private val json: Json,
) {
    suspend fun listAgents(spaceId: String): ApiResult<List<ChatAgentRow>> =
        when (val res = safeApiCall(json) { api.getChatAgents(spaceId) }) {
            is ApiResult.Success -> ApiResult.Success(res.data.agents)
            is ApiResult.Failure -> res
        }

    /** Newest first, as the server pages it; the screen reverses. */
    suspend fun getMessages(spaceId: String, name: String, cursor: String? = null): ApiResult<ChatPage> =
        safeApiCall(json) { api.getChatMessages(spaceId, name, cursor) }

    suspend fun clear(spaceId: String, name: String): ApiResult<Unit> =
        safeApiCall(json) { api.clearChat(spaceId, name); Unit }

    /**
     * One message, answered as the turn goes: `user`, then `tool` /
     * `tool_result` / `assistant` as they happen, then `done` — or `error` for
     * a refusal. The flow completes when the server closes the stream;
     * cancelling it cancels the request, which stops the writing and never the
     * turn (the finished answer is on the thread's next read).
     */
    fun send(spaceId: String, name: String, text: String): Flow<ChatEvent> = callbackFlow {
        val encodedName = URLEncoder.encode(name, "UTF-8").replace("+", "%20")
        val body = json.encodeToString(ChatSendRequest.serializer(), ChatSendRequest(text))
            .toRequestBody("application/json; charset=utf-8".toMediaType())
        val request = Request.Builder()
            .url("${AppConfig.apiBaseUrl}/api/spaces/$spaceId/agents/$encodedName/chat/stream")
            .header("Accept", "text/event-stream")
            .post(body)
            .build()

        val listener = object : EventSourceListener() {
            override fun onEvent(eventSource: EventSource, id: String?, type: String?, data: String) {
                parseChatEvent(json, data)?.let { trySend(it) }
            }

            override fun onFailure(eventSource: EventSource, t: Throwable?, response: Response?) {
                // A refusal answered before the stream opened is plain JSON with
                // an `error` sentence; word it as the same event a refusal
                // inside the stream would be, so the screen has one path.
                if (response != null && !response.isSuccessful) {
                    val raw = runCatching { response.body?.string() }.getOrNull()
                    val sentence = raw?.let { sseDataObject(json, it) }
                        ?.get("error")?.let { runCatching { it.jsonPrimitive.content }.getOrNull() }
                        ?: "Request failed (${response.code})"
                    trySend(ChatEvent.Error("http", sentence))
                    close()
                } else {
                    close(t)
                }
            }

            override fun onClosed(eventSource: EventSource) {
                close()
            }
        }

        val source = EventSources.createFactory(client).newEventSource(request, listener)
        awaitClose { source.cancel() }
    }
}
