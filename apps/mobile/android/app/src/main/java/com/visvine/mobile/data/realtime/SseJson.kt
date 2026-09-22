package com.visvine.mobile.data.realtime

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject

/**
 * The one shape every Visvine stream sends: a `data: {json}` line whose object
 * carries a `type` discriminant. Keepalive and comment lines never reach a
 * listener's `onEvent`, so this only has to survive a malformed payload — which
 * is answered with null, never a throw, because a stream must not die on one
 * bad line.
 */
fun sseDataObject(json: Json, data: String): JsonObject? =
    runCatching { json.parseToJsonElement(data) as? JsonObject }.getOrNull()
