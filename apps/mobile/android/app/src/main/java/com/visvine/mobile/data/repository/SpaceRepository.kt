package com.visvine.mobile.data.repository

import com.visvine.mobile.data.model.Space
import com.visvine.mobile.data.remote.ApiResult
import com.visvine.mobile.data.remote.MediaUrl
import com.visvine.mobile.data.remote.VisvineApi
import com.visvine.mobile.data.remote.safeApiCall
import kotlinx.serialization.json.Json
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SpaceRepository @Inject constructor(
    private val api: VisvineApi,
    private val json: Json,
) {
    suspend fun getSpaces(): ApiResult<List<Space>> =
        when (val res = safeApiCall(json) { api.getSpaces() }) {
            is ApiResult.Success -> ApiResult.Success(res.data.spaces.map(::resolve))
            is ApiResult.Failure -> res
        }

    suspend fun getSpace(id: String): ApiResult<Space> =
        when (val res = safeApiCall(json) { api.getSpace(id) }) {
            is ApiResult.Success -> ApiResult.Success(resolve(res.data))
            is ApiResult.Failure -> res
        }

    // Mirrors resolveSpace: image = resolveMediaUrl(imageUrl ?? image)
    private fun resolve(c: Space): Space =
        c.copy(image = MediaUrl.resolve(c.imageUrl ?: c.image))
}
