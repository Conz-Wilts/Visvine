package com.visvine.mobile.ui.util

import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * Date/time formatting matching the web app's `toLocale*String` output. Inputs
 * are ISO-8601 strings from the backend; rendered in the device zone.
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

    /**
     * "Fri, Aug 21, 3:00 PM – 4:00 PM" — the events feed's one facts line.
     * Mirrors EventsFeedView.formatFullDate, including the note-first case where
     * an event exists before anyone has dated it.
     */
    fun fullDate(startAt: String, endAt: String? = null): String {
        if (startAt.isEmpty()) return "No date yet"
        val datePart = fmt(startAt, "EEE, MMM d")
        val startTime = time(startAt)
        return if (!endAt.isNullOrEmpty()) "$datePart, $startTime – ${time(endAt)}" else "$datePart, $startTime"
    }

    /** "August 2026" — the month heading upcoming events are filed under. */
    fun monthKey(iso: String): String = fmt(iso, "MMMM yyyy")

    /**
     * "Starts in 3 days" / "Starting soon" / null once it has begun. Mirrors
     * lib/eventUtils.ts#startsInLabel.
     */
    fun startsInLabel(iso: String): String? {
        val instant = parse(iso) ?: return null
        val diffMs = instant.toEpochMilli() - Instant.now().toEpochMilli()
        if (diffMs < 0) return null
        val hours = diffMs / 3_600_000
        if (hours < 1) return "Starting soon"
        if (hours < 24) return "Starts in $hours ${if (hours == 1L) "hour" else "hours"}"
        val days = Math.round(diffMs / 86_400_000.0)
        if (days == 1L) return "Starts tomorrow"
        if (days < 30) return "Starts in $days days"
        val months = Math.round(days / 30.0)
        return "Starts in $months month${if (months > 1) "s" else ""}"
    }

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
