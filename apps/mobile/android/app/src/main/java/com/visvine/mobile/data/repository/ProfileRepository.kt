package com.visvine.mobile.data.repository

import com.visvine.mobile.data.model.DirectoryMember
import com.visvine.mobile.data.model.FullProfile
import com.visvine.mobile.data.model.ProfileUpdate
import com.visvine.mobile.data.remote.ApiResult
import com.visvine.mobile.data.remote.MediaUrl
import com.visvine.mobile.data.remote.VisvineApi
import com.visvine.mobile.data.remote.safeApiCall
import kotlinx.serialization.json.Json
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ProfileRepository @Inject constructor(
    private val api: VisvineApi,
    private val json: Json,
) {
    suspend fun getProfile(personId: String): ApiResult<DirectoryMember> =
        when (val res = safeApiCall(json) { api.getProfile(personId) }) {
            is ApiResult.Success -> ApiResult.Success(res.data.copy(imageUrl = MediaUrl.resolve(res.data.imageUrl)))
            is ApiResult.Failure -> res
        }

    suspend fun getFullProfile(personId: String): ApiResult<FullProfile> =
        when (val res = safeApiCall(json) { api.getFullProfile(personId) }) {
            is ApiResult.Success -> ApiResult.Success(res.data.copy(imageUrl = MediaUrl.resolve(res.data.imageUrl)))
            is ApiResult.Failure -> res
        }

    suspend fun updateProfile(userId: String, update: ProfileUpdate): ApiResult<DirectoryMember> =
        when (val res = safeApiCall(json) { api.updateProfile(userId, update) }) {
            is ApiResult.Success -> ApiResult.Success(res.data.copy(imageUrl = MediaUrl.resolve(res.data.imageUrl)))
            is ApiResult.Failure -> res
        }
}
