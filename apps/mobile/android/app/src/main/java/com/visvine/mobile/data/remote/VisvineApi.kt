package com.visvine.mobile.data.remote

import com.visvine.mobile.data.model.CommunitiesResponse
import com.visvine.mobile.data.model.Community
import com.visvine.mobile.data.model.ConversationsResponse
import com.visvine.mobile.data.model.DevUsersResponse
import com.visvine.mobile.data.model.DirectoryMember
import com.visvine.mobile.data.model.Event
import com.visvine.mobile.data.model.EventsResponse
import com.visvine.mobile.data.model.FullProfile
import com.visvine.mobile.data.model.IssueTokenRequest
import com.visvine.mobile.data.model.IssueTokenResponse
import com.visvine.mobile.data.model.Message
import com.visvine.mobile.data.model.MessagesPage
import com.visvine.mobile.data.model.NodesResponse
import com.visvine.mobile.data.model.ProfileUpdate
import com.visvine.mobile.data.model.SendMessageRequest
import com.visvine.mobile.data.model.SessionResponse
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

/**
 * The complete client → backend contract: the 12 ApiService methods across the
 * ~9 distinct routes exposed by the web backend. The backend is the
 * source of truth and is unchanged by this migration.
 */
interface VisvineApi {

    // Auth
    @GET("api/auth/session")
    suspend fun getSession(): SessionResponse

    @POST("api/auth/signout")
    suspend fun signOut(): retrofit2.Response<Unit>

    // Communities
    @GET("api/data/communities")
    suspend fun getCommunities(): CommunitiesResponse

    @GET("api/data/communities")
    suspend fun getCommunity(@Query("id") id: String): Community

    // Events
    @GET("api/events")
    suspend fun getEvents(@Query("communityId") communityId: String): EventsResponse

    @GET("api/events/{id}")
    suspend fun getEvent(@Path("id") eventId: String): Event

    // Messaging
    @GET("api/messages/conversations")
    suspend fun getConversations(@Query("query") query: String? = null): ConversationsResponse

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

    // Directory
    @GET("api/data/nodes")
    suspend fun getNodes(@Query("community_id") communityId: String): NodesResponse

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
