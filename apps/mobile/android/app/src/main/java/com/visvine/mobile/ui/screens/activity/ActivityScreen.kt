package com.visvine.mobile.ui.screens.activity

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.visvine.mobile.data.model.ActivityAction
import com.visvine.mobile.data.model.ActivityRow
import com.visvine.mobile.ui.components.EmptyState
import com.visvine.mobile.ui.components.Hairline
import com.visvine.mobile.ui.components.ScreenHeader
import com.visvine.mobile.ui.icons.AppIcons
import com.visvine.mobile.ui.theme.VisvineTheme
import com.visvine.mobile.ui.util.DateTimeFormat
import com.visvine.mobile.ui.viewmodel.ActivityViewModel

/**
 * Everything about you (docs/mobile.md § Activity): what is coming up, then
 * the runs, mentions, replies and requests, newest first, filed by day. A
 * request an admin can answer carries its two doors on the row.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun ActivityScreen(
    onProfileClick: () -> Unit,
    onOpenAgent: (spaceId: String, name: String, title: String?) -> Unit,
    onOpenConversation: (conversationId: String, name: String?) -> Unit,
    onOpenEvent: (eventId: String, title: String?) -> Unit,
    viewModel: ActivityViewModel = hiltViewModel(),
) {
    val colors = VisvineTheme.colors
    val state by viewModel.state.collectAsStateWithLifecycle()

    fun open(row: ActivityRow) {
        val t = row.target
        when (t.type) {
            "agent" -> {
                val spaceId = t.spaceId ?: return
                val name = t.agentName ?: return
                onOpenAgent(spaceId, name, row.title)
            }
            "conversation" -> {
                val id = t.conversationId ?: return
                onOpenConversation(id, null)
            }
            "event" -> {
                val id = t.eventId ?: return
                onOpenEvent(id, row.title)
            }
            else -> Unit
        }
    }

    Column(modifier = Modifier.fillMaxSize().background(colors.bgPrimary)) {
        ScreenHeader(onProfileClick = onProfileClick, showSpaceSelector = false)

        state.error?.let {
            Text(it, color = colors.error, fontSize = 14.sp, modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp))
        }

        if (state.loading) {
            Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator(color = colors.accent) }
            return@Column
        }

        PullToRefreshBox(isRefreshing = state.refreshing, onRefresh = { viewModel.refresh() }, modifier = Modifier.fillMaxSize()) {
            if (state.upcoming.isEmpty() && state.items.isEmpty()) {
                EmptyState("Nothing yet", icon = AppIcons.Bell)
            } else {
                // groupBy keeps first-appearance order and the items are newest
                // first, so the days come out in reverse calendar order.
                val days = state.items.groupBy { DateTimeFormat.dayLabel(it.at) }
                LazyColumn(modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 100.dp)) {
                    if (state.upcoming.isNotEmpty()) {
                        item(key = "upcoming-label") { SectionLabel("Coming up") }
                        itemsIndexed(state.upcoming, key = { _, it -> "up-${it.id}" }) { index, row ->
                            if (index > 0) Hairline()
                            UpcomingRow(row) { open(row) }
                        }
                    }
                    days.forEach { (day, rows) ->
                        stickyHeader(key = "day-$day") { SectionLabel(day) }
                        itemsIndexed(rows, key = { _, it -> it.id }) { index, row ->
                            if (index > 0) Hairline()
                            ActivityItem(
                                row = row,
                                decided = state.decided[row.id],
                                deciding = row.id in state.deciding,
                                onDecide = { action -> viewModel.decide(row, action) },
                                onClick = { open(row) },
                            )
                            if (row.id == state.items.last().id && state.nextCursor != null) {
                                LaunchedEffect(row.id) { viewModel.loadMore() }
                            }
                        }
                    }
                    if (state.loadingMore) item(key = "more") {
                        Box(Modifier.fillMaxWidth().padding(16.dp), Alignment.Center) {
                            CircularProgressIndicator(color = colors.accent, strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SectionLabel(text: String) {
    val colors = VisvineTheme.colors
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .background(colors.bgPrimary)
            .padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 6.dp),
    ) {
        Text(text, color = colors.textMuted, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun glyphFor(kind: String): Painter = when (kind) {
    "run" -> AppIcons.Sparkles
    "mention", "reply" -> AppIcons.Message
    "join_request", "access_request" -> AppIcons.PersonAdd
    "event" -> AppIcons.Calendar
    else -> AppIcons.Bell
}

@Composable
private fun UpcomingRow(row: ActivityRow, onClick: () -> Unit) {
    val colors = VisvineTheme.colors
    Row(
        modifier = Modifier.fillMaxWidth().clickable { onClick() }.padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(modifier = Modifier.width(36.dp), contentAlignment = Alignment.CenterStart) {
            Icon(AppIcons.Calendar, contentDescription = null, tint = colors.textMuted, modifier = Modifier.size(20.dp))
        }
        Column(modifier = Modifier.weight(1f)) {
            Text(row.title, color = colors.textPrimary, fontSize = 15.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                listOfNotNull(row.space?.name, DateTimeFormat.fullDate(row.at)).joinToString(" · "),
                color = colors.textMuted,
                fontSize = 12.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = 2.dp),
            )
        }
    }
}

@Composable
private fun ActivityItem(
    row: ActivityRow,
    decided: String?,
    deciding: Boolean,
    onDecide: (ActivityAction) -> Unit,
    onClick: () -> Unit,
) {
    val colors = VisvineTheme.colors
    val opens = row.target.type == "agent" || row.target.type == "conversation" || row.target.type == "event"
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(enabled = opens) { onClick() }
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(modifier = Modifier.width(36.dp), contentAlignment = Alignment.CenterStart) {
            Icon(glyphFor(row.kind), contentDescription = null, tint = colors.textMuted, modifier = Modifier.size(20.dp))
        }
        Column(modifier = Modifier.weight(1f)) {
            Text(row.title, color = colors.textPrimary, fontSize = 15.sp, fontWeight = FontWeight.Medium, maxLines = 2, overflow = TextOverflow.Ellipsis)
            row.subtitle?.takeIf { it.isNotBlank() }?.let {
                Text(it, color = colors.textMuted, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 2.dp))
            }
            Text(
                listOfNotNull(row.space?.name, DateTimeFormat.relativeShort(row.at)).joinToString(" · "),
                color = colors.textMuted,
                fontSize = 12.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = 2.dp),
            )
        }
        when {
            decided != null -> Box(
                modifier = Modifier
                    .padding(start = 8.dp)
                    .clip(RoundedCornerShape(6.dp))
                    .background(colors.bgTertiary)
                    .padding(horizontal = 8.dp, vertical = 4.dp),
            ) {
                Text(decided, color = colors.textMuted, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
            }
            deciding -> CircularProgressIndicator(color = colors.accent, strokeWidth = 2.dp, modifier = Modifier.padding(start = 8.dp).size(18.dp))
            row.actions.isNotEmpty() -> Row(
                modifier = Modifier.padding(start = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                row.actions.forEachIndexed { index, action ->
                    val primary = index == 0
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .background(if (primary) colors.accent else colors.bgSecondary)
                            .clickable { onDecide(action) }
                            .padding(horizontal = 12.dp, vertical = 7.dp),
                    ) {
                        Text(
                            action.label,
                            color = if (primary) Color.White else colors.textPrimary,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold,
                        )
                    }
                }
            }
        }
    }
}
