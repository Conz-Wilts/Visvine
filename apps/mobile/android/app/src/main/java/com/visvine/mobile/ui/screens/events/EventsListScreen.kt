package com.visvine.mobile.ui.screens.events

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.visvine.mobile.data.model.Event
import com.visvine.mobile.ui.components.EmptyState
import com.visvine.mobile.ui.components.ScreenHeader
import com.visvine.mobile.ui.icons.AppIcons
import com.visvine.mobile.ui.theme.VisvineTheme
import com.visvine.mobile.ui.util.DateTimeFormat
import com.visvine.mobile.ui.viewmodel.SpaceViewModel
import com.visvine.mobile.ui.viewmodel.EventsListViewModel
import com.visvine.mobile.ui.viewmodel.SearchViewModel

/**
 * One section of the feed, in the order EventsFeedView files them: undated first
 * (an event nobody can see is an event nobody dates), then the next one up on
 * its own, then the rest by month, then what has already happened.
 */
private data class EventSection(
    val title: String,
    val events: List<Event>,
    val featured: Boolean = false,
    val past: Boolean = false,
)

private fun sectionsOf(events: List<Event>): List<EventSection> {
    val undated = events.filter { it.startAt.isEmpty() }
    val dated = events.filter { it.startAt.isNotEmpty() }
    val upcoming = dated.filter { DateTimeFormat.isUpcoming(it.startAt) }.sortedBy { it.startAt }
    val past = dated.filter { !DateTimeFormat.isUpcoming(it.startAt) }.sortedByDescending { it.startAt }

    val result = mutableListOf<EventSection>()
    if (undated.isNotEmpty()) result += EventSection("Date to be set", undated)
    upcoming.firstOrNull()?.let { result += EventSection("Next event", listOf(it), featured = true) }
    // groupBy keeps first-appearance order, and the list is already sorted, so
    // the months come out in calendar order.
    upcoming.drop(1).groupBy { DateTimeFormat.monthKey(it.startAt) }
        .forEach { (month, monthEvents) -> result += EventSection(month, monthEvents) }
    if (past.isNotEmpty()) result += EventSection("Past events", past, past = true)
    return result
}

/**
 * The events feed — the mobile face of EventsFeedView: rows on hairlines under a
 * section heading, each one a title over a single line of facts.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EventsListScreen(
    onProfileClick: () -> Unit,
    onOpenEvent: (eventId: String, title: String?) -> Unit,
    viewModel: EventsListViewModel = hiltViewModel(),
    spaceViewModel: SpaceViewModel = hiltViewModel(),
    searchViewModel: SearchViewModel = hiltViewModel(),
) {
    val colors = VisvineTheme.colors
    val state by viewModel.state.collectAsStateWithLifecycle()
    val events by viewModel.filtered.collectAsStateWithLifecycle()
    val current by spaceViewModel.current.collectAsStateWithLifecycle()

    LaunchedEffect(Unit) { searchViewModel.setPlaceholder("Search events") }

    Column(modifier = Modifier.fillMaxSize().background(colors.bgPrimary)) {
        ScreenHeader(onProfileClick = onProfileClick)

        when {
            state.loading -> Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator(color = colors.accent) }
            current == null -> EmptyState("Select a space to view events", icon = AppIcons.Calendar)
            else -> PullToRefreshBox(
                isRefreshing = state.refreshing,
                onRefresh = { viewModel.refresh() },
                modifier = Modifier.fillMaxSize(),
            ) {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 120.dp),
                ) {
                    state.error?.let {
                        item {
                            Text(it, color = colors.error, fontSize = 14.sp, modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp))
                        }
                    }
                    if (events.isEmpty()) {
                        item { EmptyState("No events found", icon = AppIcons.Calendar) }
                    } else {
                        sectionsOf(events).forEach { section ->
                            item(key = "head-${section.title}") {
                                Text(
                                    section.title.uppercase(),
                                    color = colors.textMuted,
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    letterSpacing = 0.9.sp,
                                    modifier = Modifier.padding(top = 32.dp),
                                )
                            }
                            section.events.forEachIndexed { index, event ->
                                item(key = event.id) {
                                    Column {
                                        if (index > 0) {
                                            Box(Modifier.fillMaxWidth().height(1.dp).background(colors.borderSubtle))
                                        }
                                        EventRow(event, section.featured, section.past) { onOpenEvent(event.id, event.title) }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun EventRow(event: Event, featured: Boolean, past: Boolean, onClick: () -> Unit) {
    val colors = VisvineTheme.colors
    // Everything the old badges said, as one line of text under the title: when ·
    // where · how many. The countdown leads it in the accent when there is one;
    // a past event just dims.
    val countdown = if (past) null else DateTimeFormat.startsInLabel(event.startAt)
    val attendees = event.analytics.rsvpCount
    // A location without coordinates is an online event, the same test
    // EventsFeedView makes.
    val isVirtual = event.location?.lat == null
    val facts = listOfNotNull(
        DateTimeFormat.fullDate(event.startAt, event.endAt),
        if (isVirtual) "Virtual" else event.location?.label,
        if (attendees > 0) "$attendees going" else null,
    ).joinToString(" · ")

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onClick() }
            .padding(vertical = 20.dp),
    ) {
        Text(
            event.title,
            color = colors.textPrimary.copy(alpha = if (past) 0.7f else 1f),
            fontSize = if (featured) 20.sp else 17.sp,
            fontWeight = FontWeight.SemiBold,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            buildAnnotatedString {
                if (countdown != null) {
                    withStyle(SpanStyle(color = colors.accentDark, fontWeight = FontWeight.SemiBold)) { append(countdown) }
                    append(" · ")
                }
                append(facts)
            },
            color = colors.textSecondary.copy(alpha = if (past) 0.7f else 1f),
            fontSize = 14.sp,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(top = 4.dp),
        )
        event.description?.takeIf { it.isNotEmpty() }?.let { description ->
            Text(
                description,
                color = colors.textSecondary.copy(alpha = if (past) 0.7f else 1f),
                fontSize = 14.sp,
                maxLines = if (featured) 3 else 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = 8.dp),
            )
        }
    }
}
