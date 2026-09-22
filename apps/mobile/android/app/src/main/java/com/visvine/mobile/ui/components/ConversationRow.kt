package com.visvine.mobile.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.visvine.mobile.data.model.Conversation
import com.visvine.mobile.ui.theme.VisvineTheme
import com.visvine.mobile.ui.util.DateTimeFormat

/**
 * One conversation in a list: who, the last line, when, and the unread count
 * as a 6dp label. [displayName] is the other person's name for a DM and the
 * conversation's own for a group — the caller decides, because it needs the
 * viewer's id.
 */
@Composable
fun ConversationRow(
    conversation: Conversation,
    displayName: String,
    imageUrl: String?,
    onClick: () -> Unit,
) {
    val colors = VisvineTheme.colors
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onClick() }
            .padding(16.dp),
    ) {
        PersonAvatar(name = displayName, imageUrl = imageUrl, size = 48.dp)
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
