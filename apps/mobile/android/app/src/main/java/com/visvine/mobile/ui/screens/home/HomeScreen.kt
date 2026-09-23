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
import com.visvine.mobile.ui.theme.VVFontSize
import com.visvine.mobile.ui.theme.VVSpace
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

    Column(modifier = Modifier.fillMaxSize().background(colors.surface)) {
        ScreenHeader(onProfileClick = onProfileClick, showSpaceSelector = true)

        state.error?.let {
            Text(it, color = colors.danger, fontSize = VVFontSize.s14, modifier = Modifier.fillMaxWidth().padding(horizontal = VVSpace.x4, vertical = VVSpace.x3))
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
                        color = colors.fgMuted,
                        fontSize = VVFontSize.s13,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.padding(start = VVSpace.x4, end = VVSpace.x4, top = VVSpace.x3, bottom = VVSpace.x1),
                    )
                }
                when {
                    state.loading -> item(key = "loading") {
                        Box(Modifier.fillMaxWidth().padding(VVSpace.x8), Alignment.Center) { CircularProgressIndicator(color = colors.accent) }
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
                            Box(Modifier.fillMaxWidth().padding(VVSpace.x4), Alignment.Center) {
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
            .padding(horizontal = VVSpace.x4),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(VVSpace.x3),
    ) {
        Icon(icon, contentDescription = null, tint = colors.fgSecondary, modifier = Modifier.size(20.dp))
        Text(label, color = colors.fg, fontSize = VVFontSize.s15, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
        Icon(AppIcons.ChevronRight, contentDescription = null, tint = colors.fgMuted, modifier = Modifier.size(18.dp))
    }
}

@Composable
private fun FeedRow(post: FeedPost) {
    val colors = VisvineTheme.colors
    val sender = post.message.sender
    Row(modifier = Modifier.fillMaxWidth().padding(VVSpace.x4), horizontalArrangement = Arrangement.spacedBy(VVSpace.x3)) {
        PersonAvatar(name = sender.name, imageUrl = sender.image, size = 36.dp)
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(VVSpace.x1)) {
            Text(sender.name, color = colors.fg, fontSize = VVFontSize.s15, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                "${post.channel.name} · ${DateTimeFormat.relativeShort(post.message.createdAt)}",
                color = colors.fgMuted,
                fontSize = VVFontSize.s12,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (post.message.text.isNotBlank()) {
                Text(post.message.text, color = colors.fg, fontSize = VVFontSize.s15, maxLines = 6, overflow = TextOverflow.Ellipsis)
            }
            if (post.comments.isNotEmpty()) {
                val n = post.comments.size
                Text("$n ${if (n == 1) "comment" else "comments"}", color = colors.fgMuted, fontSize = VVFontSize.s12)
            }
        }
    }
}
