package com.visvine.mobile.ui.screens.messaging

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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.visvine.mobile.data.model.ChatAgentRow
import com.visvine.mobile.ui.components.ConversationRow
import com.visvine.mobile.ui.components.EmptyState
import com.visvine.mobile.ui.components.Hairline
import com.visvine.mobile.ui.components.PersonAvatar
import com.visvine.mobile.ui.components.ScreenHeader
import com.visvine.mobile.ui.components.SegmentedNav
import com.visvine.mobile.ui.icons.AppIcons
import com.visvine.mobile.ui.theme.VisvineTheme
import com.visvine.mobile.ui.util.DateTimeFormat
import com.visvine.mobile.ui.viewmodel.AgentsViewModel
import com.visvine.mobile.ui.viewmodel.ConversationsViewModel

private const val SEGMENT_AGENTS = 0
private const val SEGMENT_CONTACTS = 1

/**
 * Messages: the space's agents as standing threads, and DMs with people
 * (docs/mobile.md § Messages). One segmented switch between the two.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MessagesHubScreen(
    onProfileClick: () -> Unit,
    onOpenAgent: (spaceId: String, name: String, title: String?) -> Unit,
    onOpenConversation: (conversationId: String, name: String?) -> Unit,
    onNewMessage: () -> Unit,
    agentsViewModel: AgentsViewModel = hiltViewModel(),
    conversationsViewModel: ConversationsViewModel = hiltViewModel(),
) {
    val colors = VisvineTheme.colors
    var segment by rememberSaveable { mutableIntStateOf(SEGMENT_AGENTS) }

    Column(modifier = Modifier.fillMaxSize().background(colors.bgPrimary)) {
        ScreenHeader(onProfileClick = onProfileClick, showSpaceSelector = true)

        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            SegmentedNav(
                items = listOf("Agents", "Contacts"),
                selected = segment,
                onSelect = { segment = it },
                modifier = Modifier.weight(1f),
            )
            if (segment == SEGMENT_CONTACTS) {
                IconButton(onClick = onNewMessage, modifier = Modifier.size(36.dp)) {
                    Icon(AppIcons.PersonAdd, contentDescription = "New message", tint = colors.accent, modifier = Modifier.size(22.dp))
                }
            }
        }

        when (segment) {
            SEGMENT_AGENTS -> AgentsSegment(agentsViewModel, onOpenAgent)
            else -> ContactsSegment(conversationsViewModel, onOpenConversation)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AgentsSegment(
    viewModel: AgentsViewModel,
    onOpenAgent: (spaceId: String, name: String, title: String?) -> Unit,
) {
    val colors = VisvineTheme.colors
    val state by viewModel.state.collectAsStateWithLifecycle()

    // A thread may have moved on while a chat was open; re-read on the way back.
    LifecycleResumeEffect(Unit) {
        viewModel.refresh(quiet = true)
        onPauseOrDispose { }
    }

    state.error?.let {
        Text(it, color = colors.error, fontSize = 14.sp, modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp))
    }

    if (state.loading) {
        Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator(color = colors.accent) }
        return
    }

    PullToRefreshBox(isRefreshing = state.refreshing, onRefresh = { viewModel.refresh() }, modifier = Modifier.fillMaxSize()) {
        if (state.agents.isEmpty()) {
            EmptyState("No agents in this space", icon = AppIcons.Bot)
        } else {
            LazyColumn(modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 100.dp)) {
                itemsIndexed(state.agents, key = { _, it -> it.name }) { index, agent ->
                    if (index > 0) Hairline()
                    AgentRow(agent) {
                        val spaceId = state.spaceId ?: return@AgentRow
                        onOpenAgent(spaceId, agent.name, agent.title.ifBlank { agent.name })
                    }
                }
            }
        }
    }
}

@Composable
private fun AgentRow(agent: ChatAgentRow, onClick: () -> Unit) {
    val colors = VisvineTheme.colors
    val unread = agent.thread?.unread == true
    val title = agent.title.ifBlank { agent.name }
    val preview = agent.thread?.lastPreview ?: agent.description ?: "No messages yet"

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onClick() }
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        PersonAvatar(name = title, imageUrl = null, size = 48.dp, glyph = AppIcons.Bot)
        Column(modifier = Modifier.weight(1f).padding(start = 12.dp)) {
            Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    title,
                    color = colors.textPrimary,
                    fontSize = 16.sp,
                    fontWeight = if (unread) FontWeight.Bold else FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                agent.thread?.lastMessageAt?.let {
                    Text(DateTimeFormat.relativeShort(it), color = colors.textMuted, fontSize = 12.sp, modifier = Modifier.padding(start = 8.dp))
                }
            }
            Row(modifier = Modifier.fillMaxWidth().padding(top = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    preview,
                    color = if (unread) colors.textPrimary else colors.textMuted,
                    fontSize = 14.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                when {
                    agent.answering -> Dot(colors.accent)
                    !agent.ready -> Dot(colors.textMuted)
                }
            }
        }
    }
}

@Composable
private fun Dot(color: Color) {
    Box(modifier = Modifier.padding(start = 8.dp).size(8.dp).clip(CircleShape).background(color))
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ContactsSegment(
    viewModel: ConversationsViewModel,
    onOpenConversation: (conversationId: String, name: String?) -> Unit,
) {
    val colors = VisvineTheme.colors
    val state by viewModel.state.collectAsStateWithLifecycle()
    val all by viewModel.filtered.collectAsStateWithLifecycle()
    val userId by viewModel.currentUserId.collectAsStateWithLifecycle()
    val conversations = all.filter { it.type == "DM" }

    state.error?.let {
        Text(it, color = colors.error, fontSize = 14.sp, modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp))
    }

    if (state.loading) {
        Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator(color = colors.accent) }
        return
    }

    PullToRefreshBox(isRefreshing = state.refreshing, onRefresh = { viewModel.refresh() }, modifier = Modifier.fillMaxSize()) {
        if (conversations.isEmpty()) {
            EmptyState("No messages yet", icon = AppIcons.Message)
        } else {
            LazyColumn(modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 100.dp)) {
                itemsIndexed(conversations, key = { _, it -> it.id }) { index, conversation ->
                    if (index > 0) Hairline()
                    val name = viewModel.displayName(conversation, userId)
                    ConversationRow(
                        conversation = conversation,
                        displayName = name,
                        imageUrl = viewModel.displayImage(conversation, userId),
                    ) { onOpenConversation(conversation.id, name) }
                }
            }
        }
    }
}
