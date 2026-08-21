package com.visvine.mobile.data.remote

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import retrofit2.HttpException
import java.io.IOException

/**
 * Result envelope mirroring the API's `{ data?, error? }` shape. Every repository
 * call funnels through [safeApiCall], so network and HTTP failures arrive as a
 * [Failure] carrying a human-readable message rather than a thrown exception.
 */
sealed interface ApiResult<out T> {
    data class Success<T>(val data: T) : ApiResult<T>
    data class Failure(val error: String) : ApiResult<Nothing>
}

inline fun <T> ApiResult<T>.onSuccess(block: (T) -> Unit): ApiResult<T> {
    if (this is ApiResult.Success) block(data)
    return this
}

inline fun <T> ApiResult<T>.onFailure(block: (String) -> Unit): ApiResult<T> {
    if (this is ApiResult.Failure) block(error)
    return this
}

fun <T> ApiResult<T>.getOrNull(): T? = (this as? ApiResult.Success)?.data

/** Runs [block], converting exceptions into [ApiResult.Failure]. */
suspend fun <T> safeApiCall(json: Json, block: suspend () -> T): ApiResult<T> = try {
    ApiResult.Success(block())
} catch (e: HttpException) {
    ApiResult.Failure(parseErrorBody(json, e) ?: "Request failed")
} catch (e: IOException) {
    ApiResult.Failure(e.message ?: "Network error")
} catch (e: Exception) {
    ApiResult.Failure(e.message ?: "Network error")
}

private fun parseErrorBody(json: Json, e: HttpException): String? = try {
    val raw = e.response()?.errorBody()?.string()
    if (raw.isNullOrBlank()) null
    else (json.parseToJsonElement(raw) as? JsonObject)
        ?.get("error")?.jsonPrimitive?.content
} catch (_: Exception) {
    null
}
