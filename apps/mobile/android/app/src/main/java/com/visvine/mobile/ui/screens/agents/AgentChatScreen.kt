package com.visvine.mobile.ui.screens.agents

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.visvine.mobile.data.model.ChatMessage
import com.visvine.mobile.ui.components.DateSeparator
import com.visvine.mobile.ui.components.MessageBubble
import com.visvine.mobile.ui.components.PersonAvatar
import com.visvine.mobile.ui.icons.AppIcons
import com.visvine.mobile.ui.theme.VisvineTheme
import com.visvine.mobile.ui.util.DateTimeFormat
import com.visvine.mobile.ui.viewmodel.AgentChatViewModel
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.first

/**
 * A thread with one agent, the iMessage way: the agent named at the top, the
 * bubbles, a working line while a turn runs, the composer. History pages
 * older on scroll-to-top.
 */
@Composable
fun AgentChatScreen(
    title: String?,
    onBack: () -> Unit,
    viewModel: AgentChatViewModel = hiltViewModel(),
) {
    val colors = VisvineTheme.colors
    val state by viewModel.state.collectAsStateWithLifecycle()
    val listState = rememberLazyListState()
    val focusRequester = remember { FocusRequester() }
    var input by rememberSaveable { mutableStateOf("") }
    val agentTitle = title ?: viewModel.agentName

    // Follow the thread: a new bubble, the live answer or the working line.
    LaunchedEffect(state.loading, state.messages.size, state.live, state.working) {
        if (state.loading) return@LaunchedEffect
        val total = snapshotFlow { listState.layoutInfo.totalItemsCount }.first { it > 0 }
        listState.animateScrollToItem(total - 1)
    }

    // Scrolled back to the top: page in what came before. The first value is
    // the list at rest before the scroll to the bottom, not a person asking.
    LaunchedEffect(state.loading) {
        if (state.loading) return@LaunchedEffect
        snapshotFlow { listState.firstVisibleItemIndex }
            .distinctUntilChanged()
            .drop(1)
            .filter { it <= 1 }
            .collect { viewModel.loadOlder() }
    }

    Column(modifier = Modifier.fillMaxSize().background(colors.bgPrimary).imePadding()) {
        Row(
            modifier = Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 4.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onBack) { Icon(AppIcons.ArrowLeft, contentDescription = "Back", tint = colors.accent) }
        }

        if (state.loading) {
            Box(Modifier.weight(1f).fillMaxWidth(), Alignment.Center) { CircularProgressIndicator(color = colors.accent) }
        } else {
            LazyColumn(
                state = listState,
                modifier = Modifier.weight(1f).fillMaxWidth(),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                item(key = "header") {
                    Column(
                        modifier = Modifier.fillMaxWidth().padding(bottom = 16.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        if (state.loadingOlder) {
                            CircularProgressIndicator(color = colors.accent, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
                        }
                        PersonAvatar(name = agentTitle, imageUrl = null, size = 56.dp, glyph = AppIcons.Bot)
                        Text(agentTitle, color = colors.textPrimary, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                    }
                }

                var previousDay: String? = null
                state.messages.forEach { message ->
                    val day = DateTimeFormat.shortDate(message.createdAt)
                    if (day != previousDay) {
                        previousDay = day
                        item(key = "day-${message.id}") { DateSeparator(day) }
                    }
                    item(key = message.id) { ChatRow(message) }
                }

                item(key = "live") {
                    val live = state.live
                    val working = state.working
                    when {
                        live != null -> MessageBubble(text = live, isOwn = false, time = null, agent = true)
                        working != null -> Text(working, color = colors.textMuted, fontSize = 13.sp)
                    }
                }
            }
        }

        state.problem?.let {
            Text(it, color = colors.textMuted, fontSize = 13.sp, modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp))
        }
        state.error?.let {
            Text(it, color = colors.error, fontSize = 13.sp, modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp))
        }

        // Composer
        Row(
            modifier = Modifier.fillMaxWidth().background(colors.bgPrimary).navigationBarsPadding().padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            TextField(
                value = input,
                onValueChange = { input = it },
                placeholder = { Text("Message", color = colors.textLight) },
                maxLines = 5,
                trailingIcon = {
                    // Dictation is the keyboard's; the mic only brings it up.
                    Icon(
                        AppIcons.Mic,
                        contentDescription = "Dictate",
                        tint = colors.textMuted,
                        modifier = Modifier.size(20.dp).clickable { focusRequester.requestFocus() },
                    )
                },
                modifier = Modifier.weight(1f).heightIn(max = 140.dp).clip(RoundedCornerShape(20.dp)).focusRequester(focusRequester),
                textStyle = LocalTextStyle.current.copy(color = colors.textPrimary, fontSize = 15.sp),
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = colors.bgTertiary,
                    unfocusedContainerColor = colors.bgTertiary,
                    focusedIndicatorColor = Color.Transparent,
                    unfocusedIndicatorColor = Color.Transparent,
                    cursorColor = colors.accent,
                ),
            )
            if (input.isNotBlank()) {
                val canSend = !state.sending
                Box(
                    modifier = Modifier
                        .padding(bottom = 10.dp)
                        .size(36.dp)
                        .clip(CircleShape)
                        .background(if (canSend) colors.accent else colors.borderDefault)
                        .clickable(enabled = canSend) {
                            val text = input
                            input = ""
                            viewModel.send(text) { restored -> input = restored }
                        },
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(AppIcons.ArrowUp, contentDescription = "Send", tint = Color.White, modifier = Modifier.size(18.dp))
                }
            }
        }
    }
}

@Composable
private fun ChatRow(message: ChatMessage) {
    val own = message.role == "user"
    val failed = message.status == "failed"
    MessageBubble(
        text = message.text.ifBlank { if (failed) "Nothing came back." else "" },
        isOwn = own,
        time = DateTimeFormat.time(message.createdAt),
        agent = !own,
        muted = !own && failed,
    )
}
