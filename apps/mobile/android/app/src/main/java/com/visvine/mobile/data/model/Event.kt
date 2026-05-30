package com.visvine.mobile.data.model

import kotlinx.serialization.Serializable

/** Community event — mirrors src/types/index.ts `Event`. */
@Serializable
data class Event(
    val id: String,
    val communityId: String = "",
    val title: String,
    val description: String? = null,
    val startAt: String,
    val endAt: String? = null,
    val timezone: String? = null,
    val location: EventLocation? = null,
    val hosts: List<String> = emptyList(),
    val capacity: Int? = null,
    val visibility: String = "community",
    val analytics: EventAnalytics = EventAnalytics(),
)

@Serializable
data class EventLocation(
    val label: String = "",
    val address: String? = null,
    val lat: Double? = null,
    val lon: Double? = null,
)

@Serializable
data class EventAnalytics(
    val views: Int = 0,
    val rsvpCount: Int = 0,
    val checkinCount: Int = 0,
)

@Serializable
data class EventsResponse(
    val events: List<Event> = emptyList(),
)
