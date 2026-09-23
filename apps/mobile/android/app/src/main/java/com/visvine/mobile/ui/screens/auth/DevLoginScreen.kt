package com.visvine.mobile.ui.screens.auth

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.visvine.mobile.ui.icons.AppIcons
import com.visvine.mobile.ui.theme.VVFontSize
import com.visvine.mobile.ui.theme.VVSpace
import com.visvine.mobile.ui.theme.VisvineTheme
import com.visvine.mobile.ui.viewmodel.DevLoginViewModel


/** The dev-only sign-in: pick an anchor user instead of going through Google. */
@Composable
fun DevLoginScreen(
    onBack: () -> Unit,
    viewModel: DevLoginViewModel = hiltViewModel(),
) {
    val colors = VisvineTheme.colors
    val state by viewModel.state.collectAsStateWithLifecycle()

    Column(modifier = Modifier.fillMaxSize().background(colors.surface).statusBarsPadding()) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = VVSpace.x4, vertical = VVSpace.x3),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onBack) {
                Icon(AppIcons.ArrowLeft, contentDescription = "Back", tint = colors.fg)
            }
            Text("Dev login", color = colors.fg, fontSize = 22.sp, fontWeight = FontWeight.Bold)
        }
        Text(
            "Pick a seeded user. Available because devAuthEnabled is on and the backend has ENABLE_DEV_AUTH=true.",
            color = colors.fgMuted,
            fontSize = VVFontSize.s13,
            modifier = Modifier.padding(horizontal = VVSpace.x6, vertical = VVSpace.x1),
        )

        when {
            state.loading -> Box(Modifier.fillMaxSize(), Alignment.Center) {
                CircularProgressIndicator(color = colors.accent)
            }
            state.error != null && state.users.isEmpty() -> Text(
                state.error ?: "Dev login unavailable",
                color = colors.fgMuted,
                modifier = Modifier.padding(VVSpace.x6),
            )
            state.users.isEmpty() -> Text(
                "No anchor users found. Run `pnpm db:seed` against your local DB.",
                color = colors.fgMuted,
                modifier = Modifier.padding(VVSpace.x6),
            )
            else -> LazyColumn(modifier = Modifier.fillMaxSize()) {
                itemsIndexed(state.users, key = { _, it -> it.id }) { index, user ->
                    val signing = state.signingInId == user.id
                    val disabled = state.signingInId != null
                    if (index > 0) {
                        Box(Modifier.fillMaxWidth().height(1.dp).background(colors.lineSubtle))
                    }
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .alpha(if (signing) 0.5f else 1f)
                            .clickable(enabled = !disabled) { viewModel.signInAs(user) }
                            .padding(horizontal = VVSpace.x4, vertical = VVSpace.x3_5),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(user.name, color = colors.fg, fontSize = VVFontSize.s15, fontWeight = FontWeight.SemiBold)
                            Text(user.email, color = colors.fgMuted, fontSize = VVFontSize.s13)
                        }
                        if (signing) {
                            CircularProgressIndicator(color = colors.accent, modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                        } else {
                            Icon(AppIcons.ChevronRight, contentDescription = null, tint = colors.fgMuted)
                        }
                    }
                }
            }
        }
    }
}
