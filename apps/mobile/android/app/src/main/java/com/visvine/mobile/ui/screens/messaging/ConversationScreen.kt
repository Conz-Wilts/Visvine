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
import androidx.compose.foundation.layout.widthIn
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
import com.visvine.mobile.data.model.Message
import com.visvine.mobile.ui.icons.AppIcons
import com.visvine.mobile.ui.theme.VisvineTheme
import com.visvine.mobile.ui.util.DateTimeFormat
import com.visvine.mobile.ui.viewmodel.ConversationViewModel


/** Port of screens/Messaging/ConversationScreen.tsx. */
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

    Column(modifier = Modifier.fillMaxSize().background(colors.bgSecondary).imePadding()) {
        // Top bar
        Row(
            modifier = Modifier.fillMaxWidth().background(colors.bgPrimary).statusBarsPadding().padding(horizontal = 4.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onBack) { Icon(AppIcons.ArrowLeft, contentDescription = "Back", tint = colors.accent) }
            Text(conversationName ?: "Chat", color = colors.textPrimary, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
        }

        state.error?.let {
            Box(Modifier.fillMaxWidth().background(colors.bgTertiary).padding(horizontal = 16.dp, vertical = 12.dp)) {
                Text(it, color = colors.error, fontSize = 14.sp)
            }
        }

        if (state.loading) {
            Box(Modifier.weight(1f).fillMaxWidth(), Alignment.Center) { CircularProgressIndicator(color = colors.accent) }
        } else if (state.messages.isEmpty()) {
            Column(
                modifier = Modifier.weight(1f).fillMaxWidth().padding(48.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Box(modifier = Modifier.size(64.dp).clip(CircleShape).background(colors.bgTertiary), contentAlignment = Alignment.Center) {
                    Icon(AppIcons.Message, contentDescription = null, tint = colors.textMuted, modifier = Modifier.size(32.dp))
                }
                Text("No messages yet", color = colors.textMuted, fontSize = 16.sp, fontWeight = FontWeight.Medium, modifier = Modifier.padding(top = 12.dp))
                Text("Start the conversation!", color = colors.textLight, fontSize = 14.sp)
            }
        } else {
            LazyColumn(
                state = listState,
                modifier = Modifier.weight(1f).fillMaxWidth(),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                items(state.messages, key = { it.id }) { message -> MessageBubble(message) }
            }
        }

        // Composer
        Row(
            modifier = Modifier.fillMaxWidth().background(colors.bgPrimary).navigationBarsPadding().padding(12.dp),
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            TextField(
                value = input,
                onValueChange = { input = it },
                placeholder = { Text("Type a message...", color = colors.textLight) },
                modifier = Modifier.weight(1f).heightIn(max = 120.dp).clip(RoundedCornerShape(22.dp)),
                textStyle = LocalTextStyle.current.copy(color = colors.textPrimary, fontSize = 15.sp),
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = colors.bgTertiary,
                    unfocusedContainerColor = colors.bgTertiary,
                    focusedIndicatorColor = Color.Transparent,
                    unfocusedIndicatorColor = Color.Transparent,
                    cursorColor = colors.accent,
                ),
            )
            val canSend = input.isNotBlank() && !state.sending
            Box(
                modifier = Modifier.size(40.dp).clip(CircleShape).background(if (input.isNotBlank()) colors.accent else colors.borderDefault),
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

@Composable
private fun MessageBubble(message: Message) {
    val colors = VisvineTheme.colors
    val isOwn = message.isOwn

    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (isOwn) Arrangement.End else Arrangement.Start,
    ) {
        if (!isOwn) {
            Box(modifier = Modifier.size(32.dp).clip(CircleShape).background(colors.accentLight), contentAlignment = Alignment.Center) {
                Text(message.sender.name.take(1).uppercase(), color = colors.accentDark, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
            }
        }
        Column(
            modifier = Modifier
                .widthIn(max = 280.dp)
                .padding(start = if (isOwn) 0.dp else 8.dp)
                .clip(
                    if (isOwn) RoundedCornerShape(18.dp, 18.dp, 6.dp, 18.dp)
                    else RoundedCornerShape(18.dp, 18.dp, 18.dp, 6.dp)
                )
                .background(if (isOwn) colors.accent else colors.bgPrimary)
                .padding(12.dp),
        ) {
            if (!isOwn) Text(message.sender.name, color = colors.textMuted, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(bottom = 4.dp))
            Text(message.text, color = if (isOwn) Color.White else colors.textPrimary, fontSize = 15.sp)
            Text(
                DateTimeFormat.time(message.createdAt),
                color = if (isOwn) Color.White.copy(alpha = 0.7f) else colors.textLight,
                fontSize = 10.sp,
                modifier = Modifier.padding(top = 4.dp),
            )
        }
    }
}
