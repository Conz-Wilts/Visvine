package com.visvine.mobile.ui.screens.auth

import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.visvine.mobile.ui.icons.AppIcons
import com.visvine.mobile.ui.theme.VisvineTheme
import com.visvine.mobile.ui.viewmodel.DevLoginViewModel


/** Port of screens/Auth/DevLoginScreen.tsx. */
@Composable
fun DevLoginScreen(
    onBack: () -> Unit,
    viewModel: DevLoginViewModel = hiltViewModel(),
) {
    val colors = VisvineTheme.colors
    val state by viewModel.state.collectAsStateWithLifecycle()

    Column(modifier = Modifier.fillMaxSize().background(colors.bgSecondary).statusBarsPadding()) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onBack) {
                Icon(AppIcons.ArrowLeft, contentDescription = "Back", tint = colors.textPrimary)
            }
            Text("Dev login", color = colors.textPrimary, fontSize = 22.sp, fontWeight = FontWeight.Bold)
        }
        Text(
            "Pick a seeded user. Available because devAuthEnabled is on and the backend has ENABLE_DEV_AUTH=true.",
            color = colors.textMuted,
            fontSize = 13.sp,
            modifier = Modifier.padding(horizontal = 24.dp, vertical = 4.dp),
        )

        when {
            state.loading -> Box(Modifier.fillMaxSize(), Alignment.Center) {
                CircularProgressIndicator(color = colors.accent)
            }
            state.error != null && state.users.isEmpty() -> Text(
                state.error ?: "Dev login unavailable",
                color = colors.textMuted,
                modifier = Modifier.padding(24.dp),
            )
            state.users.isEmpty() -> Text(
                "No anchor users found. Run `pnpm db:seed` against your local DB.",
                color = colors.textMuted,
                modifier = Modifier.padding(24.dp),
            )
            else -> LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(state.users, key = { it.id }) { user ->
                    val signing = state.signingInId == user.id
                    val disabled = state.signingInId != null
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .alpha(if (signing) 0.5f else 1f)
                            .clip(RoundedCornerShape(10.dp))
                            .background(colors.bgPrimary)
                            .border(1.dp, colors.borderLight, RoundedCornerShape(10.dp))
                            .clickable(enabled = !disabled) { viewModel.signInAs(user) }
                            .padding(14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(user.name, color = colors.textPrimary, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                            Text(user.email, color = colors.textMuted, fontSize = 13.sp)
                        }
                        if (signing) {
                            CircularProgressIndicator(color = colors.accent, modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                        } else {
                            Icon(AppIcons.ChevronRight, contentDescription = null, tint = colors.textMuted)
                        }
                    }
                }
            }
        }
    }
}
