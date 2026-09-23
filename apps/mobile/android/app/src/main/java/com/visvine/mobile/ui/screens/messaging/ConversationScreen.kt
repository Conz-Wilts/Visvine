package com.visvine.mobile.ui.screens.messaging

import androidx.compose.foundation.background
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
import androidx.compose.foundation.lazy.items
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.visvine.mobile.data.remote.MediaUrl
import com.visvine.mobile.ui.components.MessageBubble
import com.visvine.mobile.ui.components.PersonAvatar
import com.visvine.mobile.ui.icons.AppIcons
import com.visvine.mobile.ui.theme.VVFontSize
import com.visvine.mobile.ui.theme.VVSpace
import com.visvine.mobile.ui.theme.VisvineTheme
import com.visvine.mobile.ui.util.DateTimeFormat
import com.visvine.mobile.ui.viewmodel.ConversationViewModel


/** One conversation: its messages, newest at the bottom, and the composer. */
@Composable
fun ConversationScreen(
    conversationName: String?,
    onBack: () -> Unit,
    viewModel: ConversationViewModel = hiltViewModel(),
) {
    val colors = VisvineTheme.colors
    val state by viewModel.state.collectAsStateWithLifecycle()
    val listState = rememberLazyListState()
    var input by rememberSaveable { mutableStateOf("") }

    LaunchedEffect(state.messages.size) {
        if (state.messages.isNotEmpty()) listState.animateScrollToItem(state.messages.size - 1)
    }

    Column(modifier = Modifier.fillMaxSize().background(colors.surfaceSubtle).imePadding()) {
        // Top bar
        Row(
            modifier = Modifier.fillMaxWidth().background(colors.surface).statusBarsPadding().padding(horizontal = VVSpace.x1, vertical = VVSpace.x1),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onBack) { Icon(AppIcons.ArrowLeft, contentDescription = "Back", tint = colors.accent) }
            Text(conversationName ?: "Chat", color = colors.fg, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
        }

        state.error?.let {
            Box(Modifier.fillMaxWidth().background(colors.surfaceMuted).padding(horizontal = VVSpace.x4, vertical = VVSpace.x3)) {
                Text(it, color = colors.danger, fontSize = VVFontSize.s14)
            }
        }

        if (state.loading) {
            Box(Modifier.weight(1f).fillMaxWidth(), Alignment.Center) { CircularProgressIndicator(color = colors.accent) }
        } else if (state.messages.isEmpty()) {
            Column(
                modifier = Modifier.weight(1f).fillMaxWidth().padding(VVSpace.x12),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Box(modifier = Modifier.size(64.dp).clip(CircleShape).background(colors.surfaceMuted), contentAlignment = Alignment.Center) {
                    Icon(AppIcons.Message, contentDescription = null, tint = colors.fgMuted, modifier = Modifier.size(32.dp))
                }
                Text("No messages yet", color = colors.fgMuted, fontSize = VVFontSize.s16, fontWeight = FontWeight.Medium, modifier = Modifier.padding(top = VVSpace.x3))
                Text("Start the conversation!", color = colors.fgSubtle, fontSize = VVFontSize.s14)
            }
        } else {
            LazyColumn(
                state = listState,
                modifier = Modifier.weight(1f).fillMaxWidth(),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(VVSpace.x3),
            ) {
                items(state.messages, key = { it.id }) { message ->
                    MessageBubble(
                        text = message.text,
                        isOwn = message.isOwn,
                        time = DateTimeFormat.time(message.createdAt),
                        senderName = message.sender.name,
                        leading = { PersonAvatar(name = message.sender.name, imageUrl = MediaUrl.resolve(message.sender.image), size = 32.dp) },
                    )
                }
            }
        }

        // Composer
        Row(
            modifier = Modifier.fillMaxWidth().background(colors.surface).navigationBarsPadding().padding(VVSpace.x3),
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(VVSpace.x2),
        ) {
            TextField(
                value = input,
                onValueChange = { input = it },
                placeholder = { Text("Type a message...", color = colors.fgSubtle) },
                modifier = Modifier.weight(1f).heightIn(max = 120.dp).clip(RoundedCornerShape(22.dp)),
                textStyle = LocalTextStyle.current.copy(color = colors.fg, fontSize = VVFontSize.s15),
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = colors.surfaceMuted,
                    unfocusedContainerColor = colors.surfaceMuted,
                    focusedIndicatorColor = Color.Transparent,
                    unfocusedIndicatorColor = Color.Transparent,
                    cursorColor = colors.accent,
                ),
            )
            val canSend = input.isNotBlank() && !state.sending
            Box(
                modifier = Modifier.size(40.dp).clip(CircleShape).background(if (input.isNotBlank()) colors.accent else colors.line),
                contentAlignment = Alignment.Center,
            ) {
                if (state.sending) {
                    CircularProgressIndicator(color = Color.White, strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
                } else {
                    IconButton(onClick = {
                        val text = input
                        input = ""
                        viewModel.send(text) { restored -> input = restored }
                    }, enabled = canSend) {
                        Icon(AppIcons.ArrowUp, contentDescription = "Send", tint = Color.White, modifier = Modifier.size(20.dp))
                    }
                }
            }
        }
    }
}
