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
import com.visvine.mobile.ui.theme.VVFontSize
import com.visvine.mobile.ui.theme.VVRadius
import com.visvine.mobile.ui.theme.VVSpace
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

    Column(modifier = Modifier.fillMaxSize().background(colors.surface)) {
        Row(
            modifier = Modifier.fillMaxWidth().background(colors.surface).statusBarsPadding().padding(horizontal = VVSpace.x1, vertical = VVSpace.x1),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onBack) { Icon(AppIcons.ArrowLeft, contentDescription = "Back", tint = colors.accent) }
            Text(state.event?.title ?: eventTitle ?: "Event", color = colors.fg, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }

        val event = state.event
        when {
            state.loading -> Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator(color = colors.accent) }
            event == null -> Box(Modifier.fillMaxSize().padding(VVSpace.x6), Alignment.Center) {
                Text(state.error ?: "Event not found", color = colors.fgSecondary, fontSize = VVFontSize.s16)
            }
            else -> EventBody(event, colors)
        }
    }
}

@Composable
private fun EventBody(event: Event, colors: DynamicColors) {
    val rsvpPct = event.capacity?.let { ((event.analytics.rsvpCount.toDouble() / it) * 100).roundToInt() } ?: 0

    Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = VVSpace.x6)) {
        // Header — the countdown leads the facts, exactly as the feed row this
        // page opened from renders it.
        Column(modifier = Modifier.fillMaxWidth().padding(horizontal = VVSpace.x4).padding(top = VVSpace.x2, bottom = VVSpace.x5)) {
            Text(event.title, color = colors.fg, fontSize = VVFontSize.s24, fontWeight = FontWeight.Bold)
            DateTimeFormat.startsInLabel(event.startAt)?.let {
                Text(it, color = colors.accentStrong, fontSize = VVFontSize.s14, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = VVSpace.x1_5))
            }
            event.description?.takeIf { it.isNotEmpty() }?.let {
                Text(it, color = colors.fgSecondary, fontSize = VVFontSize.s15, modifier = Modifier.padding(top = VVSpace.x3))
            }
        }

        // Facts
        Hairline(colors)
        Column(modifier = Modifier.fillMaxWidth().padding(VVSpace.x4), verticalArrangement = Arrangement.spacedBy(VVSpace.x4)) {
            InfoRow(AppIcons.Calendar, "Date", DateTimeFormat.longDate(event.startAt), colors)
            InfoRow(AppIcons.Clock, "Time", DateTimeFormat.time(event.startAt) + (event.endAt?.let { " - ${DateTimeFormat.time(it)}" } ?: ""), colors)
            event.timezone?.let { InfoRow(AppIcons.Globe, "Timezone", it, colors) }
            event.location?.let { InfoRow(AppIcons.Location, "Location", it.label, colors, subtext = it.address) }
        }

        // Attendance
        Hairline(colors)
        Column(modifier = Modifier.fillMaxWidth().padding(VVSpace.x4)) {
            Text("ATTENDANCE", color = colors.fgMuted, fontSize = VVFontSize.s11, fontWeight = FontWeight.SemiBold, letterSpacing = 0.9.sp, modifier = Modifier.padding(bottom = VVSpace.x3))
            Row(horizontalArrangement = Arrangement.spacedBy(VVSpace.x6)) {
                StatItem("RSVPs", event.analytics.rsvpCount.toString(), colors)
                StatItem("Checked in", event.analytics.checkinCount.toString(), colors)
                event.capacity?.let { StatItem("Spots left", (it - event.analytics.rsvpCount).toString(), colors) }
            }
            event.capacity?.let {
                Text("$rsvpPct% capacity", color = colors.fgMuted, fontSize = VVFontSize.s13, modifier = Modifier.padding(top = VVSpace.x3))
            }
        }

        if (event.visibility != "public") {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = VVSpace.x4).padding(top = VVSpace.x1),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(VVSpace.x2),
            ) {
                Icon(if (event.visibility == "private") AppIcons.Lock else AppIcons.People, contentDescription = null, tint = colors.fgMuted, modifier = Modifier.size(16.dp))
                Text(if (event.visibility == "private") "Private event" else "Space members only", color = colors.fgMuted, fontSize = VVFontSize.s14)
            }
        }

        Box(
            modifier = Modifier.fillMaxWidth().padding(horizontal = VVSpace.x4).padding(top = VVSpace.x6)
                .clip(RoundedCornerShape(VVRadius.lg)).background(colors.accent).clickable { }.padding(vertical = VVSpace.x3_5),
            contentAlignment = Alignment.Center,
        ) {
            Text("RSVP to Event", color = Color.White, fontSize = VVFontSize.s15, fontWeight = FontWeight.SemiBold)
        }
    }
}

/** The rule that opens one block of the page. */
@Composable
private fun Hairline(colors: DynamicColors) {
    Box(Modifier.fillMaxWidth().height(1.dp).background(colors.lineSubtle))
}

@Composable
private fun InfoRow(icon: Painter, label: String, value: String, colors: DynamicColors, subtext: String? = null) {
    Row(horizontalArrangement = Arrangement.spacedBy(VVSpace.x3)) {
        Icon(icon, contentDescription = null, tint = colors.fgMuted, modifier = Modifier.padding(top = VVSpace.x0_5).size(18.dp))
        Column {
            Text(label, color = colors.fgMuted, fontSize = VVFontSize.s12)
            Text(value, color = colors.fg, fontSize = VVFontSize.s15, fontWeight = FontWeight.Medium)
            subtext?.let { Text(it, color = colors.fgMuted, fontSize = VVFontSize.s14) }
        }
    }
}

/** A number and what it counts. No tile behind it — the figure is the mark. */
@Composable
private fun StatItem(label: String, value: String, colors: DynamicColors) {
    Column {
        Text(value, color = colors.fg, fontSize = VVFontSize.s24, fontWeight = FontWeight.Bold)
        Text(label, color = colors.fgMuted, fontSize = VVFontSize.s12, modifier = Modifier.padding(top = VVSpace.x0_5))
    }
}
