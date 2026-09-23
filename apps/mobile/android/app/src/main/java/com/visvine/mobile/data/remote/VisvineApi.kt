package com.visvine.mobile.data.remote

import com.visvine.mobile.data.model.ActivityPage
import com.visvine.mobile.data.model.ChatAgentsResponse
import com.visvine.mobile.data.model.ChatPage
import com.visvine.mobile.data.model.ChatSendRequest
import com.visvine.mobile.data.model.ChatSendResponse
import com.visvine.mobile.data.model.ConversationsResponse
import com.visvine.mobile.data.model.CreateDmRequest
import com.visvine.mobile.data.model.CreateDmResponse
import com.visvine.mobile.data.model.DevUsersResponse
import com.visvine.mobile.data.model.DirectoryMember
import com.visvine.mobile.data.model.Event
import com.visvine.mobile.data.model.EventsResponse
import com.visvine.mobile.data.model.FeedPage
import com.visvine.mobile.data.model.FullProfile
import com.visvine.mobile.data.model.IssueTokenRequest
import com.visvine.mobile.data.model.IssueTokenResponse
import com.visvine.mobile.data.model.Message
import com.visvine.mobile.data.model.MessagesPage
import com.visvine.mobile.data.model.NodesResponse
import com.visvine.mobile.data.model.ProfileUpdate
import com.visvine.mobile.data.model.SendMessageRequest
import com.visvine.mobile.data.model.SessionResponse
import com.visvine.mobile.data.model.Space
import com.visvine.mobile.data.model.SpacesResponse
import com.visvine.mobile.data.model.UsersSearchResponse
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

/**
 * The complete client → backend contract, one method per route the phone
 * reads or writes (docs/mobile.md). The backend is the source of truth; every
 * shape here mirrors its handler by hand.
 */
interface VisvineApi {

    // Auth
    @GET("api/auth/session")
    suspend fun getSession(): SessionResponse

    @POST("api/auth/signout")
    suspend fun signOut(): retrofit2.Response<Unit>

    // Spaces
    @GET("api/data/spaces")
    suspend fun getSpaces(): SpacesResponse

    @GET("api/data/spaces")
    suspend fun getSpace(@Query("id") id: String): Space

    // Feed
    @GET("api/feed")
    suspend fun getFeed(
        @Query("spaceId") spaceId: String?,
        @Query("cursor") cursor: String?,
        @Query("limit") limit: Int = 20,
    ): FeedPage

    // Events
    @GET("api/events")
    suspend fun getEvents(@Query("spaceId") spaceId: String): EventsResponse

    @GET("api/events/{id}")
    suspend fun getEvent(@Path("id") eventId: String): Event

    // Messaging
    @GET("api/messages/conversations")
    suspend fun getConversations(@Query("query") query: String? = null): ConversationsResponse

    @POST("api/messages/conversations")
    suspend fun createDm(@Body body: CreateDmRequest): CreateDmResponse

    @GET("api/messages/users")
    suspend fun searchUsers(@Query("query") query: String?): UsersSearchResponse

    @GET("api/messages/conversations/{id}/messages")
    suspend fun getMessages(
        @Path("id") conversationId: String,
        @Query("cursor") cursor: String? = null,
    ): MessagesPage

    @POST("api/messages/conversations/{id}/messages")
    suspend fun sendMessage(
        @Path("id") conversationId: String,
        @Body body: SendMessageRequest,
    ): Message

    // Agent chat
    @GET("api/spaces/{spaceId}/agents/chat")
    suspend fun getChatAgents(@Path("spaceId") spaceId: String): ChatAgentsResponse

    @GET("api/spaces/{spaceId}/agents/{name}/chat")
    suspend fun getChatMessages(
        @Path("spaceId") spaceId: String,
        @Path("name") name: String,
        @Query("cursor") cursor: String?,
        @Query("limit") limit: Int = 40,
    ): ChatPage

    @POST("api/spaces/{spaceId}/agents/{name}/chat")
    suspend fun sendChat(
        @Path("spaceId") spaceId: String,
        @Path("name") name: String,
        @Body body: ChatSendRequest,
    ): ChatSendResponse

    @DELETE("api/spaces/{spaceId}/agents/{name}/chat")
    suspend fun clearChat(
        @Path("spaceId") spaceId: String,
        @Path("name") name: String,
    ): retrofit2.Response<Unit>

    // Activity
    @GET("api/activity")
    suspend fun getActivity(
        @Query("cursor") cursor: String?,
        @Query("limit") limit: Int = 30,
    ): ActivityPage

    // Directory
    @GET("api/data/nodes")
    suspend fun getNodes(@Query("space_id") spaceId: String): NodesResponse

    // Profile — same route, two shapes (member vs. full profile)
    @GET("api/profile/{id}")
    suspend fun getProfile(@Path("id") personId: String): DirectoryMember

    @GET("api/profile/{id}")
    suspend fun getFullProfile(@Path("id") personId: String): FullProfile

    @PATCH("api/profile/{id}")
    suspend fun updateProfile(
        @Path("id") userId: String,
        @Body body: ProfileUpdate,
    ): DirectoryMember

    // Dev auth (only used when devAuthEnabled and backend ENABLE_DEV_AUTH=true)
    @GET("api/dev/list-users")
    suspend fun listDevUsers(): DevUsersResponse

    @POST("api/dev/issue-token")
    suspend fun issueDevToken(@Body body: IssueTokenRequest): IssueTokenResponse
}
