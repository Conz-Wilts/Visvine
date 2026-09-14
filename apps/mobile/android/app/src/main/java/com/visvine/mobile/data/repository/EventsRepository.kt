package com.visvine.mobile.data.repository

import com.visvine.mobile.data.model.Event
import com.visvine.mobile.data.remote.ApiResult
import com.visvine.mobile.data.remote.VisvineApi
import com.visvine.mobile.data.remote.safeApiCall
import kotlinx.serialization.json.Json
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class EventsRepository @Inject constructor(
    private val api: VisvineApi,
    private val json: Json,
) {
    suspend fun getEvents(spaceId: String): ApiResult<List<Event>> =
        when (val res = safeApiCall(json) { api.getEvents(spaceId) }) {
            is ApiResult.Success -> ApiResult.Success(res.data.events)
            is ApiResult.Failure -> res
        }

    suspend fun getEvent(eventId: String): ApiResult<Event> =
        safeApiCall(json) { api.getEvent(eventId) }
}
