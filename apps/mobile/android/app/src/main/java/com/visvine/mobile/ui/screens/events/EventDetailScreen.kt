package com.visvine.mobile.ui.screens.events

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.visvine.mobile.data.model.Event
import com.visvine.mobile.ui.icons.AppIcons
import com.visvine.mobile.ui.theme.DynamicColors
import com.visvine.mobile.ui.theme.VisvineTheme
import com.visvine.mobile.ui.util.DateTimeFormat
import com.visvine.mobile.ui.viewmodel.EventDetailViewModel
import kotlin.math.roundToInt


/**
 * One event, in full: title and description, then the facts, attendance and the
 * RSVP action as blocks on the flat surface, divided by hairlines.
 */
@Composable
fun EventDetailScreen(
    eventTitle: String?,
    onBack: () -> Unit,
    viewModel: EventDetailViewModel = hiltViewModel(),
) {
    val colors = VisvineTheme.colors
    val state by viewModel.state.collectAsStateWithLifecycle()

    Column(modifier = Modifier.fillMaxSize().background(colors.bgPrimary)) {
        Row(
            modifier = Modifier.fillMaxWidth().background(colors.bgPrimary).statusBarsPadding().padding(horizontal = 4.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onBack) { Icon(AppIcons.ArrowLeft, contentDescription = "Back", tint = colors.accent) }
            Text(state.event?.title ?: eventTitle ?: "Event", color = colors.textPrimary, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }

        val event = state.event
        when {
            state.loading -> Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator(color = colors.accent) }
            event == null -> Box(Modifier.fillMaxSize().padding(24.dp), Alignment.Center) {
                Text(state.error ?: "Event not found", color = colors.textSecondary, fontSize = 16.sp)
            }
            else -> EventBody(event, colors)
        }
    }
}

@Composable
private fun EventBody(event: Event, colors: DynamicColors) {
    val rsvpPct = event.capacity?.let { ((event.analytics.rsvpCount.toDouble() / it) * 100).roundToInt() } ?: 0

    Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = 24.dp)) {
        // Header — the countdown leads the facts, exactly as the feed row this
        // page opened from renders it.
        Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(top = 8.dp, bottom = 20.dp)) {
            Text(event.title, color = colors.textPrimary, fontSize = 24.sp, fontWeight = FontWeight.Bold)
            DateTimeFormat.startsInLabel(event.startAt)?.let {
                Text(it, color = colors.accentDark, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 6.dp))
            }
            event.description?.takeIf { it.isNotEmpty() }?.let {
                Text(it, color = colors.textSecondary, fontSize = 15.sp, modifier = Modifier.padding(top = 12.dp))
            }
        }

        // Facts
        Hairline(colors)
        Column(modifier = Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            InfoRow(AppIcons.Calendar, "Date", DateTimeFormat.longDate(event.startAt), colors)
            InfoRow(AppIcons.Clock, "Time", DateTimeFormat.time(event.startAt) + (event.endAt?.let { " - ${DateTimeFormat.time(it)}" } ?: ""), colors)
            event.timezone?.let { InfoRow(AppIcons.Globe, "Timezone", it, colors) }
            event.location?.let { InfoRow(AppIcons.Location, "Location", it.label, colors, subtext = it.address) }
        }

        // Attendance
        Hairline(colors)
        Column(modifier = Modifier.fillMaxWidth().padding(16.dp)) {
            Text("ATTENDANCE", color = colors.textMuted, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.9.sp, modifier = Modifier.padding(bottom = 12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                StatItem("RSVPs", event.analytics.rsvpCount.toString(), colors)
                StatItem("Checked in", event.analytics.checkinCount.toString(), colors)
                event.capacity?.let { StatItem("Spots left", (it - event.analytics.rsvpCount).toString(), colors) }
            }
            event.capacity?.let {
                Text("$rsvpPct% capacity", color = colors.textMuted, fontSize = 13.sp, modifier = Modifier.padding(top = 12.dp))
            }
        }

        if (event.visibility != "public") {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(top = 4.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(if (event.visibility == "private") AppIcons.Lock else AppIcons.People, contentDescription = null, tint = colors.textMuted, modifier = Modifier.size(16.dp))
                Text(if (event.visibility == "private") "Private event" else "Space members only", color = colors.textMuted, fontSize = 14.sp)
            }
        }

        Box(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(top = 24.dp)
                .clip(RoundedCornerShape(8.dp)).background(colors.accent).clickable { }.padding(vertical = 14.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text("RSVP to Event", color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}

/** The rule that opens one block of the page. */
@Composable
private fun Hairline(colors: DynamicColors) {
    Box(Modifier.fillMaxWidth().height(1.dp).background(colors.borderSubtle))
}

@Composable
private fun InfoRow(icon: Painter, label: String, value: String, colors: DynamicColors, subtext: String? = null) {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Icon(icon, contentDescription = null, tint = colors.textMuted, modifier = Modifier.padding(top = 2.dp).size(18.dp))
        Column {
            Text(label, color = colors.textMuted, fontSize = 12.sp)
            Text(value, color = colors.textPrimary, fontSize = 15.sp, fontWeight = FontWeight.Medium)
            subtext?.let { Text(it, color = colors.textMuted, fontSize = 14.sp) }
        }
    }
}

/** A number and what it counts. No tile behind it — the figure is the mark. */
@Composable
private fun StatItem(label: String, value: String, colors: DynamicColors) {
    Column {
        Text(value, color = colors.textPrimary, fontSize = 24.sp, fontWeight = FontWeight.Bold)
        Text(label, color = colors.textMuted, fontSize = 12.sp, modifier = Modifier.padding(top = 2.dp))
    }
}
