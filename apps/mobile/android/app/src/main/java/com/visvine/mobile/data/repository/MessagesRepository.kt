package com.visvine.mobile.data.repository

import com.visvine.mobile.data.model.Conversation
import com.visvine.mobile.data.model.CreateDmRequest
import com.visvine.mobile.data.model.Message
import com.visvine.mobile.data.model.MessageSender
import com.visvine.mobile.data.model.MessagesPage
import com.visvine.mobile.data.model.SendMessageRequest
import com.visvine.mobile.data.realtime.MessageStream
import com.visvine.mobile.data.realtime.RealtimeEvent
import com.visvine.mobile.data.remote.ApiResult
import com.visvine.mobile.data.remote.MediaUrl
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

    /** The DM with one person, made on first use. */
    suspend fun createDm(userId: String): ApiResult<Conversation> =
        when (val res = safeApiCall(json) { api.createDm(CreateDmRequest(userId)) }) {
            is ApiResult.Success -> ApiResult.Success(res.data.conversation)
            is ApiResult.Failure -> res
        }

    /** People the caller may message, by name; images resolved against the API base. */
    suspend fun searchUsers(query: String?): ApiResult<List<MessageSender>> =
        when (val res = safeApiCall(json) { api.searchUsers(query?.trim()?.ifBlank { null }) }) {
            is ApiResult.Success -> ApiResult.Success(
                res.data.users.map { it.copy(image = MediaUrl.resolve(it.image)) },
            )
            is ApiResult.Failure -> res
        }

    /** Foreground realtime feed off `/api/messages/stream`. */
    fun realtimeEvents(): Flow<RealtimeEvent> = stream.events()
}
