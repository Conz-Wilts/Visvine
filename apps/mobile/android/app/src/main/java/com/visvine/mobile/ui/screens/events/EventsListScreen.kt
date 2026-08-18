package com.visvine.mobile.ui.screens.events

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.visvine.mobile.data.model.Event
import com.visvine.mobile.ui.components.ScreenHeader
import com.visvine.mobile.ui.icons.AppIcons
import com.visvine.mobile.ui.theme.VisvineTheme
import com.visvine.mobile.ui.util.DateTimeFormat
import com.visvine.mobile.ui.viewmodel.CommunityViewModel
import com.visvine.mobile.ui.viewmodel.EventsListViewModel
import com.visvine.mobile.ui.viewmodel.SearchViewModel
import androidx.compose.ui.graphics.painter.Painter


/** Port of screens/Events/EventsListScreen.tsx. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EventsListScreen(
    onProfileClick: () -> Unit,
    onOpenEvent: (eventId: String, title: String?) -> Unit,
    viewModel: EventsListViewModel = hiltViewModel(),
    communityViewModel: CommunityViewModel = hiltViewModel(),
    searchViewModel: SearchViewModel = hiltViewModel(),
) {
    val colors = VisvineTheme.colors
    val state by viewModel.state.collectAsStateWithLifecycle()
    val events by viewModel.filtered.collectAsStateWithLifecycle()
    val current by communityViewModel.current.collectAsStateWithLifecycle()

    LaunchedEffect(Unit) { searchViewModel.setPlaceholder("Search events") }

    Column(modifier = Modifier.fillMaxSize().background(colors.bgSecondary)) {
        ScreenHeader(onProfileClick = onProfileClick)

        when {
            state.loading -> Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator(color = colors.accent) }
            current == null -> EmptyMessage("Select a space to view events")
            else -> PullToRefreshBox(
                isRefreshing = state.refreshing,
                onRefresh = { viewModel.refresh() },
                modifier = Modifier.fillMaxSize(),
            ) {
                LazyColumn(modifier = Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    state.error?.let {
                        item {
                            Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(colors.bgTertiary).padding(16.dp)) {
                                Text(it, color = colors.error, fontSize = 14.sp)
                            }
                        }
                    }
                    if (events.isEmpty()) {
                        item { EmptyMessage("No events found", inline = true) }
                    } else {
                        items(events, key = { it.id }) { event -> EventCard(event) { onOpenEvent(event.id, event.title) } }
                    }
                }
            }
        }
    }
}

@Composable
private fun EventCard(event: Event, onClick: () -> Unit) {
    val colors = VisvineTheme.colors
    val upcoming = DateTimeFormat.isUpcoming(event.startAt)

    Row(
        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(colors.bgPrimary).clickable { onClick() }.padding(16.dp),
    ) {
        Column(
            modifier = Modifier.width(52.dp).clip(RoundedCornerShape(12.dp)).background(colors.accentLight).padding(vertical = 8.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(DateTimeFormat.monthShort(event.startAt).uppercase(), color = colors.accentDark, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
            Text(DateTimeFormat.dayOfMonth(event.startAt), color = colors.textPrimary, fontSize = 22.sp, fontWeight = FontWeight.Bold)
        }
        Column(modifier = Modifier.weight(1f).padding(start = 14.dp)) {
            Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.SpaceBetween) {
                Text(event.title, color = colors.textPrimary, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f).padding(end = 8.dp))
                if (upcoming) {
                    Box(modifier = Modifier.clip(RoundedCornerShape(999.dp)).background(colors.accentLight).padding(horizontal = 10.dp, vertical = 3.dp)) {
                        Text("Upcoming", color = colors.accentDark, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
            event.location?.let { loc ->
                MetaRow(AppIcons.Location, loc.label)
            }
            MetaRow(AppIcons.Clock, "${DateTimeFormat.shortDate(event.startAt)} at ${DateTimeFormat.time(event.startAt)}")
            Row(modifier = Modifier.padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    Icon(AppIcons.People, contentDescription = null, tint = colors.textMuted, modifier = Modifier.size(14.dp))
                    Text("${event.analytics.rsvpCount} RSVPs", color = colors.textMuted, fontSize = 12.sp)
                }
                event.capacity?.let { cap ->
                    Box(modifier = Modifier.clip(RoundedCornerShape(999.dp)).background(colors.accentLight).padding(horizontal = 8.dp, vertical = 2.dp)) {
                        Text("${cap - event.analytics.rsvpCount} spots left", color = colors.accentDark, fontSize = 11.sp, fontWeight = FontWeight.Medium)
                    }
                }
            }
        }
    }
}

@Composable
private fun MetaRow(icon: Painter, text: String) {
    val colors = VisvineTheme.colors
    Row(modifier = Modifier.padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
        Icon(icon, contentDescription = null, tint = colors.textMuted, modifier = Modifier.size(14.dp))
        Text(text, color = colors.textMuted, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun EmptyMessage(text: String, inline: Boolean = false) {
    val colors = VisvineTheme.colors
    Column(
        modifier = (if (inline) Modifier.fillMaxWidth() else Modifier.fillMaxSize()).padding(vertical = 48.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(modifier = Modifier.size(72.dp).clip(RoundedCornerShape(36.dp)).background(colors.bgTertiary), contentAlignment = Alignment.Center) {
            Icon(AppIcons.Calendar, contentDescription = null, tint = colors.textMuted, modifier = Modifier.size(36.dp))
        }
        Text(text, color = colors.textMuted, fontSize = 16.sp, fontWeight = FontWeight.Medium)
    }
}
