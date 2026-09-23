package com.visvine.mobile.ui.screens.home

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
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
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.visvine.mobile.data.model.FeedPost
import com.visvine.mobile.ui.components.EmptyState
import com.visvine.mobile.ui.components.Hairline
import com.visvine.mobile.ui.components.PersonAvatar
import com.visvine.mobile.ui.components.ScreenHeader
import com.visvine.mobile.ui.icons.AppIcons
import com.visvine.mobile.ui.theme.VisvineTheme
import com.visvine.mobile.ui.util.DateTimeFormat
import com.visvine.mobile.ui.viewmodel.HomeViewModel

/**
 * The space: two rows into the Directory and Events, then its feed
 * (docs/mobile.md § Home).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    onProfileClick: () -> Unit,
    onOpenPeople: () -> Unit,
    onOpenEvents: () -> Unit,
    viewModel: HomeViewModel = hiltViewModel(),
) {
    val colors = VisvineTheme.colors
    val state by viewModel.state.collectAsStateWithLifecycle()

    Column(modifier = Modifier.fillMaxSize().background(colors.bgPrimary)) {
        ScreenHeader(onProfileClick = onProfileClick, showSpaceSelector = true)

        state.error?.let {
            Text(it, color = colors.error, fontSize = 14.sp, modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp))
        }

        PullToRefreshBox(
            isRefreshing = state.refreshing,
            onRefresh = { viewModel.refresh() },
            modifier = Modifier.weight(1f).fillMaxWidth(),
        ) {
            LazyColumn(modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 100.dp)) {
                item(key = "people") {
                    Hairline()
                    NavRow("People", AppIcons.People, onOpenPeople)
                }
                item(key = "events") {
                    Hairline()
                    NavRow("Events", AppIcons.Calendar, onOpenEvents)
                    Hairline()
                }
                item(key = "feed-label") {
                    Text(
                        "Feed",
                        color = colors.textMuted,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 4.dp),
                    )
                }
                when {
                    state.loading -> item(key = "loading") {
                        Box(Modifier.fillMaxWidth().padding(32.dp), Alignment.Center) { CircularProgressIndicator(color = colors.accent) }
                    }
                    state.posts.isEmpty() -> item(key = "empty") {
                        EmptyState("Nothing in this space's feed yet", icon = AppIcons.Message)
                    }
                    else -> {
                        itemsIndexed(state.posts, key = { _, it -> it.message.id }) { index, post ->
                            if (index > 0) Hairline()
                            FeedRow(post)
                            if (index == state.posts.lastIndex && state.nextCursor != null) {
                                LaunchedEffect(post.message.id) { viewModel.loadMore() }
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
}

@Composable
private fun NavRow(label: String, icon: Painter, onClick: () -> Unit) {
    val colors = VisvineTheme.colors
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(48.dp)
            .clickable { onClick() }
            .padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(icon, contentDescription = null, tint = colors.textSecondary, modifier = Modifier.size(20.dp))
        Text(label, color = colors.textPrimary, fontSize = 15.sp, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
        Icon(AppIcons.ChevronRight, contentDescription = null, tint = colors.textMuted, modifier = Modifier.size(18.dp))
    }
}

@Composable
private fun FeedRow(post: FeedPost) {
    val colors = VisvineTheme.colors
    val sender = post.message.sender
    Row(modifier = Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        PersonAvatar(name = sender.name, imageUrl = sender.image, size = 36.dp)
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(sender.name, color = colors.textPrimary, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                "${post.channel.name} · ${DateTimeFormat.relativeShort(post.message.createdAt)}",
                color = colors.textMuted,
                fontSize = 12.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (post.message.text.isNotBlank()) {
                Text(post.message.text, color = colors.textPrimary, fontSize = 15.sp, maxLines = 6, overflow = TextOverflow.Ellipsis)
            }
            if (post.comments.isNotEmpty()) {
                val n = post.comments.size
                Text("$n ${if (n == 1) "comment" else "comments"}", color = colors.textMuted, fontSize = 12.sp)
            }
        }
    }
}
