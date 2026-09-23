package com.visvine.mobile.ui.screens.messaging

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.visvine.mobile.ui.components.ConversationRow
import com.visvine.mobile.ui.components.EmptyState
import com.visvine.mobile.ui.components.Hairline
import com.visvine.mobile.ui.components.ScreenHeader
import com.visvine.mobile.ui.icons.AppIcons
import com.visvine.mobile.ui.theme.VVFontSize
import com.visvine.mobile.ui.theme.VVSpace
import com.visvine.mobile.ui.theme.VisvineTheme
import com.visvine.mobile.ui.viewmodel.ConversationsViewModel


/** Every conversation in the space, most recently active first. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConversationsListScreen(
    onProfileClick: () -> Unit,
    onOpenConversation: (conversationId: String, name: String?) -> Unit,
    viewModel: ConversationsViewModel = hiltViewModel(),
) {
    val colors = VisvineTheme.colors
    val state by viewModel.state.collectAsStateWithLifecycle()
    val conversations by viewModel.filtered.collectAsStateWithLifecycle()
    val userId by viewModel.currentUserId.collectAsStateWithLifecycle()
    val query by viewModel.query.collectAsStateWithLifecycle()

    Column(modifier = Modifier.fillMaxSize().background(colors.surface)) {
        ScreenHeader(onProfileClick = onProfileClick, showSpaceSelector = false)

        state.error?.let {
            Text(it, color = colors.danger, fontSize = VVFontSize.s14, modifier = Modifier.fillMaxWidth().padding(horizontal = VVSpace.x4, vertical = VVSpace.x3))
        }

        if (state.loading) {
            Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator(color = colors.accent) }
        } else {
            PullToRefreshBox(isRefreshing = state.refreshing, onRefresh = { viewModel.refresh() }, modifier = Modifier.fillMaxSize()) {
                if (conversations.isEmpty()) {
                    EmptyState(
                        text = if (query.isNotEmpty()) "No conversations found" else "No messages yet",
                        icon = AppIcons.Message,
                    )
                } else {
                    LazyColumn(modifier = Modifier.fillMaxSize()) {
                        itemsIndexed(conversations, key = { _, it -> it.id }) { index, conversation ->
                            if (index > 0) Hairline()
                            ConversationRow(
                                conversation = conversation,
                                displayName = viewModel.displayName(conversation, userId),
                                imageUrl = viewModel.displayImage(conversation, userId),
                            ) {
                                onOpenConversation(conversation.id, viewModel.displayName(conversation, userId))
                            }
                        }
                    }
                }
            }
        }
    }
}
