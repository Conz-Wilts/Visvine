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
import androidx.compose.foundation.layout.width
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
import kotlin.math.min
import kotlin.math.roundToInt


/** Port of screens/Events/EventDetailScreen.tsx. */
@Composable
fun EventDetailScreen(
    eventTitle: String?,
    onBack: () -> Unit,
    viewModel: EventDetailViewModel = hiltViewModel(),
) {
    val colors = VisvineTheme.colors
    val state by viewModel.state.collectAsStateWithLifecycle()

    Column(modifier = Modifier.fillMaxSize().background(colors.bgSecondary)) {
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
        // Header
        Column(modifier = Modifier.fillMaxWidth().background(colors.bgPrimary).padding(20.dp)) {
            Column(
                modifier = Modifier.width(56.dp).clip(RoundedCornerShape(12.dp)).background(colors.accentLight).padding(vertical = 8.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(DateTimeFormat.monthShort(event.startAt).uppercase(), color = colors.accentDark, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                Text(DateTimeFormat.dayOfMonth(event.startAt), color = colors.textPrimary, fontSize = 28.sp, fontWeight = FontWeight.Bold)
            }
            Text(event.title, color = colors.textPrimary, fontSize = 24.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 16.dp))
            event.description?.let { Text(it, color = colors.textMuted, fontSize = 15.sp, modifier = Modifier.padding(top = 8.dp)) }
        }

        // Info
        Column(modifier = Modifier.fillMaxWidth().padding(16.dp).clip(RoundedCornerShape(16.dp)).background(colors.bgPrimary).padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            InfoRow(AppIcons.Calendar, "Date", DateTimeFormat.longDate(event.startAt), colors)
            InfoRow(AppIcons.Clock, "Time", DateTimeFormat.time(event.startAt) + (event.endAt?.let { " - ${DateTimeFormat.time(it)}" } ?: ""), colors)
            event.timezone?.let { InfoRow(AppIcons.Globe, "Timezone", it, colors) }
            event.location?.let { InfoRow(AppIcons.Location, "Location", it.label, colors, subtext = it.address) }
        }

        // Attendance
        Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).clip(RoundedCornerShape(16.dp)).background(colors.bgPrimary).padding(20.dp)) {
            Text("Attendance", color = colors.textPrimary, fontSize = 18.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(bottom = 16.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                StatItem("RSVPs", event.analytics.rsvpCount.toString(), colors.accentDark, colors, Modifier.weight(1f))
                StatItem("Checked In", event.analytics.checkinCount.toString(), colors.accentDark, colors, Modifier.weight(1f))
                event.capacity?.let { StatItem("Spots Left", (it - event.analytics.rsvpCount).toString(), colors.success, colors, Modifier.weight(1f)) }
            }
            event.capacity?.let {
                Column(modifier = Modifier.padding(top = 16.dp)) {
                    Box(modifier = Modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(4.dp)).background(colors.bgTertiary)) {
                        Box(modifier = Modifier.fillMaxWidth(min(rsvpPct, 100) / 100f).height(8.dp).clip(RoundedCornerShape(4.dp)).background(colors.accent))
                    }
                    Text("$rsvpPct% capacity", color = colors.textMuted, fontSize = 12.sp, modifier = Modifier.fillMaxWidth().padding(top = 8.dp), textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                }
            }
        }

        if (event.visibility != "public") {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp).clip(RoundedCornerShape(12.dp)).background(colors.bgTertiary).padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(if (event.visibility == "private") AppIcons.Lock else AppIcons.People, contentDescription = null, tint = colors.textMuted, modifier = Modifier.size(16.dp))
                Text(if (event.visibility == "private") "Private event" else "Space members only", color = colors.textMuted, fontSize = 14.sp)
            }
        }

        Box(modifier = Modifier.fillMaxWidth().padding(20.dp).clip(RoundedCornerShape(14.dp)).background(colors.accent).clickable { }.padding(vertical = 16.dp), contentAlignment = Alignment.Center) {
            Text("RSVP to Event", color = Color.White, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
private fun InfoRow(icon: Painter, label: String, value: String, colors: DynamicColors, subtext: String? = null) {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Box(modifier = Modifier.size(36.dp).clip(RoundedCornerShape(10.dp)).background(colors.accentLight), contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription = null, tint = colors.accentDark, modifier = Modifier.size(18.dp))
        }
        Column {
            Text(label, color = colors.textMuted, fontSize = 12.sp)
            Text(value, color = colors.textPrimary, fontSize = 15.sp, fontWeight = FontWeight.Medium)
            subtext?.let { Text(it, color = colors.textMuted, fontSize = 14.sp) }
        }
    }
}

@Composable
private fun StatItem(label: String, value: String, valueColor: Color, colors: DynamicColors, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier.clip(RoundedCornerShape(12.dp)).background(colors.bgSecondary).padding(vertical = 16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(value, color = valueColor, fontSize = 26.sp, fontWeight = FontWeight.Bold)
        Text(label, color = colors.textMuted, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp))
    }
}
