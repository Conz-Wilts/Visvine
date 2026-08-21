package com.visvine.mobile.data.realtime

import com.visvine.mobile.core.AppConfig
import com.visvine.mobile.data.local.TokenStore
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources
import javax.inject.Inject
import javax.inject.Singleton

/**
 * One realtime event off `/api/messages/stream`. We only surface the discriminant
 * `type` and the optional `conversationId`; screens re-fetch on relevant events
 * rather than patching state from the payload. This is foreground delivery only —
 * background delivery needs push, which is not wired up yet.
 */
data class RealtimeEvent(
    val type: String,
    val conversationId: String?,
)

/**
 * SSE consumer. The browser EventSource API can't set headers, so — like the
 * iOS plan — we hand-roll over OkHttp with an `Authorization: Bearer` header and
 * surface connection drops so callers can reconnect. A 401 (expired 30-day JWT)
 * arrives as [EventSourceListener.onFailure]; the AuthViewModel treats a failed
 * session refresh as the signal to clear the token.
 */
@Singleton
class MessageStream @Inject constructor(
    private val client: OkHttpClient,
    private val tokenStore: TokenStore,
    private val json: Json,
) {
    fun events(): Flow<RealtimeEvent> = callbackFlow {
        val token = tokenStore.currentToken()
        val request = Request.Builder()
            .url("${AppConfig.apiBaseUrl}/api/messages/stream")
            .header("Accept", "text/event-stream")
            .apply { if (!token.isNullOrBlank()) header("Authorization", "Bearer $token") }
            .build()

        val listener = object : EventSourceListener() {
            override fun onEvent(
                eventSource: EventSource,
                id: String?,
                type: String?,
                data: String,
            ) {
                // Backend sends `data: {json}` lines; keepalive/comment lines are
                // delivered as comments and never reach onEvent.
                runCatching {
                    val obj = json.parseToJsonElement(data) as? JsonObject ?: return
                    val eventType = obj["type"]?.jsonPrimitive?.content ?: return
                    val convoId = obj["conversationId"]?.jsonPrimitive?.content
                    trySend(RealtimeEvent(eventType, convoId))
                }
            }

            override fun onFailure(
                eventSource: EventSource,
                t: Throwable?,
                response: okhttp3.Response?,
            ) {
                close(t)
            }

            override fun onClosed(eventSource: EventSource) {
                close()
            }
        }

        val source = EventSources.createFactory(client).newEventSource(request, listener)
        awaitClose { source.cancel() }
    }
}
