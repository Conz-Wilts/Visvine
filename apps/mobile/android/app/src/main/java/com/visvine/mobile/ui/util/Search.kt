package com.visvine.mobile.ui.util

/**
 * Name-only relevance score — identical to the web `useDashboardSearch` heuristic
 * reused across Directory / Events / Conversations. A score of 0 means "no match".
 */
fun searchScore(needle: String, name: String): Int {
    val n = name.lowercase()
    if (n == needle) return 10000
    val idx = n.indexOf(needle)
    if (idx == -1) return 0
    if (idx == 0) return 5000 - needle.length
    return 1000 - idx * 10
}

/** Filters + relevance-sorts by [name] when [query] is non-blank, else returns [items] unchanged. */
inline fun <T> rankByQuery(items: List<T>, query: String, name: (T) -> String): List<T> {
    val needle = query.trim().lowercase()
    if (needle.isEmpty()) return items
    return items
        .map { it to searchScore(needle, name(it)) }
        .filter { it.second > 0 }
        .sortedByDescending { it.second }
        .map { it.first }
}
