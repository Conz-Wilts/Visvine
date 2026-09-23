package com.visvine.mobile.ui.screens.messaging

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.visvine.mobile.ui.components.EmptyState
import com.visvine.mobile.ui.components.Hairline
import com.visvine.mobile.ui.components.PersonAvatar
import com.visvine.mobile.ui.icons.AppIcons
import com.visvine.mobile.ui.theme.VVFontSize
import com.visvine.mobile.ui.theme.VVRadius
import com.visvine.mobile.ui.theme.VVSpace
import com.visvine.mobile.ui.theme.VisvineTheme
import com.visvine.mobile.ui.viewmodel.NewMessageViewModel

/** Who to message: a search over the people the caller can reach, then their DM. */
@Composable
fun NewMessageScreen(
    onBack: () -> Unit,
    onOpenConversation: (conversationId: String, name: String) -> Unit,
    viewModel: NewMessageViewModel = hiltViewModel(),
) {
    val colors = VisvineTheme.colors
    val state by viewModel.state.collectAsStateWithLifecycle()
    val query by viewModel.query.collectAsStateWithLifecycle()

    Column(modifier = Modifier.fillMaxSize().background(colors.surface)) {
        Row(
            modifier = Modifier.fillMaxWidth().background(colors.surface).statusBarsPadding().padding(horizontal = VVSpace.x1, vertical = VVSpace.x1),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onBack) { Icon(AppIcons.ArrowLeft, contentDescription = "Back", tint = colors.accent) }
            Text("New message", color = colors.fg, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
        }

        TextField(
            value = query,
            onValueChange = { viewModel.setQuery(it) },
            placeholder = { Text("Search people", color = colors.fgSubtle) },
            singleLine = true,
            leadingIcon = { Icon(AppIcons.Search, contentDescription = null, tint = colors.fgMuted, modifier = Modifier.size(18.dp)) },
            modifier = Modifier.fillMaxWidth().padding(horizontal = VVSpace.x4, vertical = VVSpace.x2).clip(RoundedCornerShape(VVRadius.xl)),
            textStyle = LocalTextStyle.current.copy(color = colors.fg, fontSize = VVFontSize.s15),
            colors = TextFieldDefaults.colors(
                focusedContainerColor = colors.surfaceMuted,
                unfocusedContainerColor = colors.surfaceMuted,
                focusedIndicatorColor = Color.Transparent,
                unfocusedIndicatorColor = Color.Transparent,
                cursorColor = colors.accent,
            ),
        )

        state.error?.let {
            Text(it, color = colors.danger, fontSize = VVFontSize.s14, modifier = Modifier.fillMaxWidth().padding(horizontal = VVSpace.x4, vertical = VVSpace.x2))
        }

        if (state.loading && state.users.isEmpty()) {
            Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator(color = colors.accent) }
        } else if (state.users.isEmpty()) {
            EmptyState(if (query.isBlank()) "No one to message yet" else "No one found", icon = AppIcons.People)
        } else {
            LazyColumn(modifier = Modifier.fillMaxSize()) {
                itemsIndexed(state.users, key = { _, it -> it.id }) { index, user ->
                    if (index > 0) Hairline()
                    val opening = state.opening == user.id
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable(enabled = state.opening == null) {
                                viewModel.open(user) { id, name -> onOpenConversation(id, name) }
                            }
                            .padding(horizontal = VVSpace.x4, vertical = VVSpace.x3),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(VVSpace.x3),
                    ) {
                        PersonAvatar(name = user.name, imageUrl = user.image, size = 40.dp)
                        Text(
                            user.name,
                            color = colors.fg,
                            fontSize = VVFontSize.s15,
                            fontWeight = FontWeight.Medium,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f),
                        )
                        if (opening) {
                            CircularProgressIndicator(color = colors.accent, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
                        }
                    }
                }
            }
        }
    }
}
