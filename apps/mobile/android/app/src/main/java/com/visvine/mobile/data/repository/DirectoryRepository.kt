package com.visvine.mobile.data.repository

import com.visvine.mobile.data.model.DirectoryMember
import com.visvine.mobile.data.remote.ApiResult
import com.visvine.mobile.data.remote.MediaUrl
import com.visvine.mobile.data.remote.VisvineApi
import com.visvine.mobile.data.remote.safeApiCall
import kotlinx.serialization.json.Json
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class DirectoryRepository @Inject constructor(
    private val api: VisvineApi,
    private val json: Json,
) {
    suspend fun getMembers(spaceId: String): ApiResult<List<DirectoryMember>> =
        when (val res = safeApiCall(json) { api.getNodes(spaceId) }) {
            is ApiResult.Success -> ApiResult.Success(
                res.data.nodes.map { it.copy(imageUrl = MediaUrl.resolve(it.imageUrl)) }
            )
            is ApiResult.Failure -> res
        }
}
