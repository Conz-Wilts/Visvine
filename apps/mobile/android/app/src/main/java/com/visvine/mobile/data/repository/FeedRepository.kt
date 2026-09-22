package com.visvine.mobile.data.repository

import com.visvine.mobile.data.model.FeedPage
import com.visvine.mobile.data.remote.ApiResult
import com.visvine.mobile.data.remote.MediaUrl
import com.visvine.mobile.data.remote.VisvineApi
import com.visvine.mobile.data.remote.safeApiCall
import kotlinx.serialization.json.Json
import javax.inject.Inject
import javax.inject.Singleton

/** The space's feed — posts in the FEED-mode channels the caller has joined. */
@Singleton
class FeedRepository @Inject constructor(
    private val api: VisvineApi,
    private val json: Json,
) {
    suspend fun getFeed(spaceId: String?, cursor: String? = null): ApiResult<FeedPage> =
        when (val res = safeApiCall(json) { api.getFeed(spaceId, cursor) }) {
            is ApiResult.Success -> ApiResult.Success(
                res.data.copy(
                    posts = res.data.posts.map { post ->
                        post.copy(
                            message = post.message.copy(
                                sender = post.message.sender.copy(image = MediaUrl.resolve(post.message.sender.image)),
                                attachmentUrl = MediaUrl.resolve(post.message.attachmentUrl),
                            ),
                        )
                    },
                ),
            )
            is ApiResult.Failure -> res
        }
}
