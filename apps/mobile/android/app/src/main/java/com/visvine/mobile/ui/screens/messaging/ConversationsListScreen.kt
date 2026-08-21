package com.visvine.mobile.ui.screens.messaging

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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
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
import com.visvine.mobile.data.model.Conversation
import com.visvine.mobile.ui.components.EmptyState
import com.visvine.mobile.ui.components.ScreenHeader
import com.visvine.mobile.ui.icons.AppIcons
import com.visvine.mobile.ui.theme.VisvineTheme
import com.visvine.mobile.ui.util.DateTimeFormat
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

    Column(modifier = Modifier.fillMaxSize().background(colors.bgPrimary)) {
        ScreenHeader(onProfileClick = onProfileClick, showCommunitySelector = false)

        state.error?.let {
            Text(it, color = colors.error, fontSize = 14.sp, modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp))
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
                            if (index > 0) {
                                Box(Modifier.fillMaxWidth().height(1.dp).background(colors.borderSubtle))
                            }
                            ConversationRow(conversation, viewModel.displayName(conversation, userId)) {
                                onOpenConversation(conversation.id, viewModel.displayName(conversation, userId))
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ConversationRow(conversation: Conversation, displayName: String, onClick: () -> Unit) {
    val colors = VisvineTheme.colors
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onClick() }
            .padding(16.dp),
    ) {
        Box(modifier = Modifier.size(48.dp).clip(CircleShape).background(colors.accentLight), contentAlignment = Alignment.Center) {
            Text(displayName.take(1).uppercase(), color = colors.accentDark, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
        }
        Column(modifier = Modifier.weight(1f).padding(start = 12.dp)) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(displayName, color = colors.textPrimary, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                conversation.lastMessage?.let {
                    Text(DateTimeFormat.relativeShort(it.createdAt), color = colors.textMuted, fontSize = 12.sp, modifier = Modifier.padding(start = 8.dp))
                }
            }
            Row(modifier = Modifier.fillMaxWidth().padding(top = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                val preview = conversation.lastMessage?.let { "${it.sender.name}: ${it.text}" } ?: "No messages yet"
                Text(preview, color = colors.textMuted, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                if (conversation.unreadCount > 0) {
                    Box(modifier = Modifier.padding(start = 8.dp).clip(RoundedCornerShape(6.dp)).background(colors.accent).padding(horizontal = 8.dp, vertical = 2.dp)) {
                        Text(conversation.unreadCount.toString(), color = colors.bgPrimary, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        }
    }
}
