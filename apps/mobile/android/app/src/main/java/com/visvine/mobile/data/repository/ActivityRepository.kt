package com.visvine.mobile.data.repository

import com.visvine.mobile.core.AppConfig
import com.visvine.mobile.data.model.ActivityAction
import com.visvine.mobile.data.model.ActivityPage
import com.visvine.mobile.data.remote.ApiResult
import com.visvine.mobile.data.remote.MediaUrl
import com.visvine.mobile.data.remote.VisvineApi
import com.visvine.mobile.data.remote.safeApiCall
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Activity — everything about the caller (docs/mobile.md § Activity). The
 * list is one Retrofit read; a decision goes to whatever route the row named
 * (`actions[].href` + `method` + `body`), which is an arbitrary path Retrofit
 * would need a method per shape for, so it is one OkHttp call on the shared
 * client — the AuthInterceptor already on it attaches the bearer.
 */
@Singleton
class ActivityRepository @Inject constructor(
    private val api: VisvineApi,
    private val client: OkHttpClient,
    private val json: Json,
) {
    suspend fun list(cursor: String? = null): ApiResult<ActivityPage> =
        when (val res = safeApiCall(json) { api.getActivity(cursor) }) {
            is ApiResult.Success -> ApiResult.Success(
                res.data.copy(
                    items = res.data.items.map { row ->
                        row.copy(actor = row.actor?.copy(image = MediaUrl.resolve(row.actor.image)))
                    },
                ),
            )
            is ApiResult.Failure -> res
        }

    /** Approve or decline through the door the row named. Any 2xx is a yes. */
    suspend fun decide(action: ActivityAction): ApiResult<Unit> = withContext(Dispatchers.IO) {
        runCatching {
            val method = action.method.uppercase().ifBlank { "PUT" }
            val mediaType = "application/json; charset=utf-8".toMediaType()
            val payload: JsonObject? = action.body
            val body = when {
                payload != null -> json.encodeToString(JsonObject.serializer(), payload).toRequestBody(mediaType)
                method == "DELETE" || method == "GET" -> null
                else -> "{}".toRequestBody(mediaType)
            }
            val request = Request.Builder()
                .url("${AppConfig.apiBaseUrl}${action.href}")
                .method(method, body)
                .build()
            client.newCall(request).execute().use { response ->
                if (response.isSuccessful) {
                    ApiResult.Success(Unit)
                } else {
                    val raw = runCatching { response.body?.string() }.getOrNull()
                    val sentence = raw
                        ?.let { runCatching { json.parseToJsonElement(it) as? JsonObject }.getOrNull() }
                        ?.get("error")?.let { runCatching { it.jsonPrimitive.content }.getOrNull() }
                    ApiResult.Failure(sentence ?: "Request failed (${response.code})")
                }
            }
        }.getOrElse { ApiResult.Failure(it.message ?: "Network error") }
    }
}
