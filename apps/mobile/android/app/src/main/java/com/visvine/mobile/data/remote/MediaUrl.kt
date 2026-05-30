package com.visvine.mobile.data.remote

import com.visvine.mobile.core.AppConfig

/**
 * Faithful port of `resolveMediaUrl` in src/services/api.ts — one of the few
 * pieces of real client logic worth porting exactly (covered by MediaUrlTest).
 *
 *  - null / empty            → null
 *  - absolute http(s)/data:  → unchanged
 *  - leading-slash path      → prefixed with the API base
 *  - bare token (no slash)   → left alone
 */
object MediaUrl {
    private val absolute = Regex("^(https?:|data:)")

    fun resolve(url: String?): String? {
        if (url.isNullOrEmpty()) return null
        if (absolute.containsMatchIn(url)) return url
        if (url.startsWith("/")) return "${AppConfig.apiBaseUrl}$url"
        return url
    }
}
