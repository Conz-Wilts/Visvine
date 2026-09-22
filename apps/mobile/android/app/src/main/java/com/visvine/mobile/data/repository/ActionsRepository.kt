package com.visvine.mobile.data.repository

import com.visvine.mobile.data.model.AddContextRequest
import com.visvine.mobile.data.model.EditContextRequest
import com.visvine.mobile.data.model.EditContextResult
import com.visvine.mobile.data.remote.ApiResult
import com.visvine.mobile.data.remote.VisvineApi
import com.visvine.mobile.data.remote.safeApiCall
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Quick capture — the Home composer's two writes (docs/mobile.md § Quick
 * capture). A note lands in `inbox/`, an ordinary folder of the space's own
 * that appears because something is in it; a Person / Space / Resource goes
 * through `add_context`, which makes the node and its note. Neither needs a
 * model.
 */
@Singleton
class ActionsRepository @Inject constructor(
    private val api: VisvineApi,
    private val json: Json,
) {
    suspend fun captureNote(spaceId: String, text: String): ApiResult<EditContextResult> {
        val trimmed = text.trim()
        val firstLine = trimmed.lineSequence().firstOrNull()?.trim().orEmpty()
        val title = firstLine.take(80).ifBlank { "Note" }
        val path = "inbox/${stamp()}-${slugOf(firstLine)}.md"
        val content = "---\ntitle: ${yamlScalar(title)}\ntags: [capture]\n---\n\n$trimmed"
        return when (val res = safeApiCall(json) { api.editContext(EditContextRequest(spaceId, path, content)) }) {
            is ApiResult.Success -> ApiResult.Success(res.data.result)
            is ApiResult.Failure -> res
        }
    }

    suspend fun captureEntity(spaceId: String, type: String, name: String, body: String?): ApiResult<JsonObject> =
        when (val res = safeApiCall(json) { api.addContext(AddContextRequest(spaceId, type, name, body?.ifBlank { null })) }) {
            is ApiResult.Success -> ApiResult.Success(res.data.result)
            is ApiResult.Failure -> res
        }

    private companion object {
        val STAMP: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd-HHmm")

        fun stamp(): String = LocalDateTime.now().format(STAMP)

        /** First line lowercased, runs of anything but a-z / 0-9 folded to `-`, at most 40 chars. */
        fun slugOf(line: String): String =
            line.lowercase()
                .replace(Regex("[^a-z0-9]+"), "-")
                .trim('-')
                .take(40)
                .trim('-')
                .ifBlank { "note" }

        /** A title is one YAML scalar; quote it when its characters would read as structure. */
        fun yamlScalar(value: String): String =
            if (Regex("[:#\\[\\]{}&*!|>'\"%@`,?]").containsMatchIn(value) || value.startsWith("-")) {
                "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""
            } else {
                value
            }
    }
}
