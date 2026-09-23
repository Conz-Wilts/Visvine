package com.visvine.mobile.ui.screens.profile

import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.visvine.mobile.ui.icons.AppIcons
import com.visvine.mobile.ui.theme.VVFontSize
import com.visvine.mobile.ui.theme.VVSpace
import com.visvine.mobile.ui.theme.VisvineTheme
import com.visvine.mobile.ui.viewmodel.ProfileViewModel
import com.visvine.mobile.ui.viewmodel.SpaceViewModel


/** Your own profile: a header, then sections divided by hairlines. */
@Composable
fun ProfileScreen(
    onBack: () -> Unit,
    onEditProfile: () -> Unit,
    onSettings: () -> Unit,
    viewModel: ProfileViewModel = hiltViewModel(),
    spaceViewModel: SpaceViewModel = hiltViewModel(),
) {
    val colors = VisvineTheme.colors
    val state by viewModel.state.collectAsStateWithLifecycle()
    val user by viewModel.user.collectAsStateWithLifecycle()
    val spaces by spaceViewModel.spaces.collectAsStateWithLifecycle()
    val current by spaceViewModel.current.collectAsStateWithLifecycle()
    var showSignOut by remember { mutableStateOf(false) }

    Column(modifier = Modifier.fillMaxSize().background(colors.surface)) {
        Row(
            modifier = Modifier.fillMaxWidth().background(colors.surface).statusBarsPadding().padding(horizontal = VVSpace.x1, vertical = VVSpace.x1),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onBack) { Icon(AppIcons.ArrowLeft, contentDescription = "Back", tint = colors.accent) }
            Text("Profile", color = colors.fg, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
        }

        if (state.loading) {
            Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator(color = colors.accent) }
        } else {

        val profile = state.profile
        val displayName = profile?.name ?: user?.name ?: "Unknown"
        val initials = displayName.split(" ").mapNotNull { it.firstOrNull() }.joinToString("").take(2).uppercase()
        val avatarUrl = profile?.imageUrl ?: user?.image

        Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = VVSpace.x8)) {
            // Header
            Column(modifier = Modifier.fillMaxWidth().padding(VVSpace.x6), horizontalAlignment = Alignment.CenterHorizontally) {
                Box(contentAlignment = Alignment.BottomEnd) {
                    if (!avatarUrl.isNullOrEmpty()) {
                        AsyncImage(model = avatarUrl, contentDescription = displayName, contentScale = ContentScale.Crop, modifier = Modifier.size(100.dp).clip(CircleShape))
                    } else {
                        Box(modifier = Modifier.size(100.dp).clip(CircleShape).background(colors.accentSoft), contentAlignment = Alignment.Center) {
                            Text(initials, color = colors.accentStrong, fontSize = VVFontSize.s36, fontWeight = FontWeight.SemiBold)
                        }
                    }
                    Box(modifier = Modifier.size(32.dp).clip(CircleShape).background(colors.surface).border(1.dp, colors.lineSubtle, CircleShape).clickable { onEditProfile() }, contentAlignment = Alignment.Center) {
                        Icon(AppIcons.Edit, contentDescription = "Edit", tint = colors.accent, modifier = Modifier.size(16.dp))
                    }
                }
                Text(displayName, color = colors.fg, fontSize = VVFontSize.s24, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = VVSpace.x4))
                profile?.title?.let { Text(it, color = colors.fgMuted, fontSize = VVFontSize.s16) }
                profile?.company?.let { Text(it, color = colors.fgMuted, fontSize = VVFontSize.s14) }
            }

            // Contact
            if (!user?.email.isNullOrEmpty() || !profile?.location.isNullOrEmpty()) {
                Section {
                    SectionTitle("Contact Information")
                    user?.email?.takeIf { it.isNotEmpty() }?.let { InfoRow("Email", it) }
                    profile?.location?.let { InfoRow("Location", it) }
                }
            }

            // Spaces
            Section {
                SectionTitle("Spaces")
                spaces.forEach { space ->
                    val active = current?.id == space.id
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(vertical = VVSpace.x3),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(VVSpace.x3),
                    ) {
                        Box(Modifier.size(8.dp).clip(CircleShape).background(colors.accent))
                        Text(space.name, color = if (active) colors.accent else colors.fgSecondary, fontSize = VVFontSize.s16, fontWeight = if (active) FontWeight.Medium else FontWeight.Normal, modifier = Modifier.weight(1f))
                        if (active) Icon(AppIcons.CircleCheck, contentDescription = null, tint = colors.accent, modifier = Modifier.size(20.dp))
                    }
                }
            }

            // Menu
            Section {
                MenuItem(AppIcons.Person, "Edit Profile", onEditProfile)
                MenuItem(AppIcons.Settings, "Settings", onSettings)
                MenuItem(AppIcons.Help, "Help & Support") {}
            }

            // Sign out
            Section {
                Row(
                    modifier = Modifier.fillMaxWidth().clickable { showSignOut = true }.padding(vertical = VVSpace.x3_5),
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(AppIcons.Logout, contentDescription = null, tint = colors.danger, modifier = Modifier.size(20.dp))
                    Text("Sign Out", color = colors.danger, fontSize = VVFontSize.s16, fontWeight = FontWeight.Medium, modifier = Modifier.padding(start = VVSpace.x2))
                }
            }

            Text("Version 0.1.0", color = colors.fgMuted, fontSize = VVFontSize.s12, modifier = Modifier.fillMaxWidth().padding(top = VVSpace.x6), textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        }
        }
    }

    if (showSignOut) {
        AlertDialog(
            onDismissRequest = { showSignOut = false },
            title = { Text("Sign Out") },
            text = { Text("Are you sure you want to sign out?") },
            confirmButton = { TextButton(onClick = { showSignOut = false; viewModel.logout() }) { Text("Sign Out", color = colors.danger) } },
            dismissButton = { TextButton(onClick = { showSignOut = false }) { Text("Cancel") } },
        )
    }
}

/**
 * A block of rows on the flat surface, opened by a hairline. No card, no radius
 * — the rule is what separates one group from the next.
 */
@Composable
private fun Section(content: @Composable () -> Unit) {
    val colors = VisvineTheme.colors
    Column(modifier = Modifier.fillMaxWidth().padding(top = VVSpace.x2)) {
        Box(Modifier.fillMaxWidth().height(1.dp).background(colors.lineSubtle))
        Column(modifier = Modifier.fillMaxWidth().padding(horizontal = VVSpace.x4, vertical = VVSpace.x2)) {
            content()
        }
    }
}

@Composable
private fun SectionTitle(text: String) {
    val colors = VisvineTheme.colors
    Text(
        text.uppercase(),
        color = colors.fgMuted,
        fontSize = VVFontSize.s11,
        fontWeight = FontWeight.SemiBold,
        letterSpacing = 0.9.sp,
        modifier = Modifier.padding(top = VVSpace.x3, bottom = VVSpace.x1),
    )
}

@Composable
private fun InfoRow(label: String, value: String) {
    val colors = VisvineTheme.colors
    Column(modifier = Modifier.fillMaxWidth().padding(vertical = VVSpace.x3)) {
        Text(label, color = colors.fgMuted, fontSize = VVFontSize.s12)
        Text(value, color = colors.fg, fontSize = VVFontSize.s16)
    }
}

@Composable
private fun MenuItem(icon: Painter, label: String, onClick: () -> Unit) {
    val colors = VisvineTheme.colors
    Row(
        modifier = Modifier.fillMaxWidth().clickable { onClick() }.padding(vertical = VVSpace.x3_5),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(VVSpace.x3),
    ) {
        Icon(icon, contentDescription = null, tint = colors.fgSecondary, modifier = Modifier.size(24.dp))
        Text(label, color = colors.fgSecondary, fontSize = VVFontSize.s16, modifier = Modifier.weight(1f))
        Icon(AppIcons.ChevronRight, contentDescription = null, tint = colors.fgMuted, modifier = Modifier.size(20.dp))
    }
}
