package com.visvine.mobile.ui.util

import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * Date/time formatting that mirrors the RN screens' `toLocale*String` output.
 * Inputs are ISO-8601 strings from the backend; rendered in the device zone.
 */
object DateTimeFormat {
    private val zone: ZoneId get() = ZoneId.systemDefault()

    private fun parse(iso: String): Instant? = runCatching { OffsetDateTime.parse(iso).toInstant() }
        .recoverCatching { Instant.parse(iso) }
        .getOrNull()

    private fun fmt(iso: String, pattern: String): String {
        val instant = parse(iso) ?: return iso
        return DateTimeFormatter.ofPattern(pattern, Locale.getDefault()).withZone(zone).format(instant)
    }

    /** "Mon, Jan 5" */
    fun shortDate(iso: String): String = fmt(iso, "EEE, MMM d")

    /** "Monday, January 5, 2026" */
    fun longDate(iso: String): String = fmt(iso, "EEEE, MMMM d, yyyy")

    /** "3:00 PM" */
    fun time(iso: String): String = fmt(iso, "h:mm a")

    /** "Jan" */
    fun monthShort(iso: String): String = fmt(iso, "MMM")

    /** "5" */
    fun dayOfMonth(iso: String): String = fmt(iso, "d")

    fun isUpcoming(iso: String): Boolean {
        val instant = parse(iso) ?: return false
        return instant.isAfter(Instant.now())
    }

    /** Conversations list relative format: now / 5m / 3h / 2d / "Mar 4". */
    fun relativeShort(iso: String): String {
        val instant = parse(iso) ?: return iso
        val diffMs = Instant.now().toEpochMilli() - instant.toEpochMilli()
        val mins = diffMs / 60_000
        val hours = diffMs / 3_600_000
        val days = diffMs / 86_400_000
        return when {
            mins < 1 -> "now"
            mins < 60 -> "${mins}m"
            hours < 24 -> "${hours}h"
            days < 7 -> "${days}d"
            else -> fmt(iso, "MMM d")
        }
    }
}
