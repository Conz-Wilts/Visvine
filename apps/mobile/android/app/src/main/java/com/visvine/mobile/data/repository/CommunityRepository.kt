package com.visvine.mobile.data.repository

import com.visvine.mobile.data.model.Community
import com.visvine.mobile.data.remote.ApiResult
import com.visvine.mobile.data.remote.MediaUrl
import com.visvine.mobile.data.remote.VisvineApi
import com.visvine.mobile.data.remote.safeApiCall
import kotlinx.serialization.json.Json
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class CommunityRepository @Inject constructor(
    private val api: VisvineApi,
    private val json: Json,
) {
    suspend fun getCommunities(): ApiResult<List<Community>> =
        when (val res = safeApiCall(json) { api.getCommunities() }) {
            is ApiResult.Success -> ApiResult.Success(res.data.communities.map(::resolve))
            is ApiResult.Failure -> res
        }

    suspend fun getCommunity(id: String): ApiResult<Community> =
        when (val res = safeApiCall(json) { api.getCommunity(id) }) {
            is ApiResult.Success -> ApiResult.Success(resolve(res.data))
            is ApiResult.Failure -> res
        }

    // Mirrors resolveCommunity: image = resolveMediaUrl(imageUrl ?? image)
    private fun resolve(c: Community): Community =
        c.copy(image = MediaUrl.resolve(c.imageUrl ?: c.image))
}
