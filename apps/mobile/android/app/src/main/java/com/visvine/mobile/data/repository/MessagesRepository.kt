package com.visvine.mobile.data.repository

import com.visvine.mobile.data.model.Conversation
import com.visvine.mobile.data.model.Message
import com.visvine.mobile.data.model.MessagesPage
import com.visvine.mobile.data.model.SendMessageRequest
import com.visvine.mobile.data.realtime.MessageStream
import com.visvine.mobile.data.realtime.RealtimeEvent
import com.visvine.mobile.data.remote.ApiResult
import com.visvine.mobile.data.remote.VisvineApi
import com.visvine.mobile.data.remote.safeApiCall
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.Json
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class MessagesRepository @Inject constructor(
    private val api: VisvineApi,
    private val stream: MessageStream,
    private val json: Json,
) {
    suspend fun getConversations(query: String? = null): ApiResult<List<Conversation>> =
        when (val res = safeApiCall(json) { api.getConversations(query?.ifBlank { null }) }) {
            is ApiResult.Success -> ApiResult.Success(res.data.conversations)
            is ApiResult.Failure -> res
        }

    suspend fun getMessages(conversationId: String, cursor: String? = null): ApiResult<MessagesPage> =
        safeApiCall(json) { api.getMessages(conversationId, cursor) }

    suspend fun sendMessage(conversationId: String, text: String): ApiResult<Message> =
        safeApiCall(json) { api.sendMessage(conversationId, SendMessageRequest(text)) }

    /** Foreground realtime feed off `/api/messages/stream`. */
    fun realtimeEvents(): Flow<RealtimeEvent> = stream.events()
}
