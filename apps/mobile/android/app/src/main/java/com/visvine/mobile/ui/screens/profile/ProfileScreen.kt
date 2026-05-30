package com.visvine.mobile.ui.screens.profile

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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.outlined.HelpOutline
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Settings
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.visvine.mobile.ui.theme.VisvineTheme
import com.visvine.mobile.ui.viewmodel.CommunityViewModel
import com.visvine.mobile.ui.viewmodel.ProfileViewModel

/** Port of screens/Profile/ProfileScreen.tsx. */
@Composable
fun ProfileScreen(
    onBack: () -> Unit,
    onEditProfile: () -> Unit,
    onSettings: () -> Unit,
    viewModel: ProfileViewModel = hiltViewModel(),
    communityViewModel: CommunityViewModel = hiltViewModel(),
) {
    val colors = VisvineTheme.colors
    val state by viewModel.state.collectAsStateWithLifecycle()
    val user by viewModel.user.collectAsStateWithLifecycle()
    val communities by communityViewModel.communities.collectAsStateWithLifecycle()
    val current by communityViewModel.current.collectAsStateWithLifecycle()
    var showSignOut by remember { mutableStateOf(false) }

    Column(modifier = Modifier.fillMaxSize().background(colors.bgSecondary)) {
        Row(
            modifier = Modifier.fillMaxWidth().background(colors.bgPrimary).statusBarsPadding().padding(horizontal = 4.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = colors.accent) }
            Text("Profile", color = colors.textPrimary, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
        }

        if (state.loading) {
            Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator(color = colors.accent) }
        } else {

        val profile = state.profile
        val displayName = profile?.name ?: user?.name ?: "Unknown"
        val initials = displayName.split(" ").mapNotNull { it.firstOrNull() }.joinToString("").take(2).uppercase()
        val avatarUrl = profile?.imageUrl ?: user?.image

        Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = 32.dp)) {
            // Header
            Column(modifier = Modifier.fillMaxWidth().background(colors.bgPrimary).padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Box(contentAlignment = Alignment.BottomEnd) {
                    if (!avatarUrl.isNullOrEmpty()) {
                        AsyncImage(model = avatarUrl, contentDescription = displayName, contentScale = ContentScale.Crop, modifier = Modifier.size(100.dp).clip(CircleShape))
                    } else {
                        Box(modifier = Modifier.size(100.dp).clip(CircleShape).background(colors.accentLight), contentAlignment = Alignment.Center) {
                            Text(initials, color = colors.accentDark, fontSize = 36.sp, fontWeight = FontWeight.SemiBold)
                        }
                    }
                    Box(modifier = Modifier.size(32.dp).clip(CircleShape).background(colors.bgPrimary).clickable { onEditProfile() }, contentAlignment = Alignment.Center) {
                        Icon(Icons.Filled.Edit, contentDescription = "Edit", tint = colors.accent, modifier = Modifier.size(16.dp))
                    }
                }
                Text(displayName, color = colors.textPrimary, fontSize = 24.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 16.dp))
                profile?.title?.let { Text(it, color = colors.textMuted, fontSize = 16.sp) }
                profile?.company?.let { Text(it, color = colors.textMuted, fontSize = 14.sp) }
            }

            // Contact
            if (!user?.email.isNullOrEmpty() || !profile?.location.isNullOrEmpty()) {
                Card(colors.bgPrimary) {
                    SectionTitle("Contact Information")
                    user?.email?.takeIf { it.isNotEmpty() }?.let { InfoRow("Email", it) }
                    profile?.location?.let { InfoRow("Location", it) }
                }
            }

            // Communities
            Card(colors.bgPrimary) {
                SectionTitle("Communities")
                communities.forEach { community ->
                    val active = current?.id == community.id
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Box(Modifier.size(8.dp).clip(CircleShape).background(colors.accent))
                        Text(community.name, color = if (active) colors.accent else colors.textSecondary, fontSize = 16.sp, fontWeight = if (active) FontWeight.Medium else FontWeight.Normal, modifier = Modifier.weight(1f))
                        if (active) Icon(Icons.Filled.CheckCircle, contentDescription = null, tint = colors.accent, modifier = Modifier.size(20.dp))
                    }
                }
            }

            // Menu
            Card(colors.bgPrimary) {
                MenuItem(Icons.Outlined.Person, "Edit Profile", onEditProfile)
                MenuItem(Icons.Outlined.Settings, "Settings", onSettings)
                MenuItem(Icons.Outlined.Notifications, "Notifications") {}
                MenuItem(Icons.Outlined.HelpOutline, "Help & Support") {}
            }

            // Sign out
            Card(colors.bgPrimary) {
                Row(
                    modifier = Modifier.fillMaxWidth().clickable { showSignOut = true }.padding(vertical = 14.dp),
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.AutoMirrored.Filled.Logout, contentDescription = null, tint = colors.error, modifier = Modifier.size(20.dp))
                    Text("Sign Out", color = colors.error, fontSize = 16.sp, fontWeight = FontWeight.Medium, modifier = Modifier.padding(start = 8.dp))
                }
            }

            Text("Version 0.1.0", color = colors.textMuted, fontSize = 12.sp, modifier = Modifier.fillMaxWidth().padding(top = 24.dp), textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        }
        }
    }

    if (showSignOut) {
        AlertDialog(
            onDismissRequest = { showSignOut = false },
            title = { Text("Sign Out") },
            text = { Text("Are you sure you want to sign out?") },
            confirmButton = { TextButton(onClick = { showSignOut = false; viewModel.logout() }) { Text("Sign Out", color = colors.error) } },
            dismissButton = { TextButton(onClick = { showSignOut = false }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun Card(bg: androidx.compose.ui.graphics.Color, content: @Composable () -> Unit) {
    Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(top = 12.dp).clip(RoundedCornerShape(16.dp)).background(bg).padding(horizontal = 16.dp, vertical = 8.dp)) {
        content()
    }
}

@Composable
private fun SectionTitle(text: String) {
    val colors = VisvineTheme.colors
    Text(text.uppercase(), color = colors.textMuted, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(vertical = 8.dp))
}

@Composable
private fun InfoRow(label: String, value: String) {
    val colors = VisvineTheme.colors
    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp)) {
        Text(label, color = colors.textMuted, fontSize = 12.sp)
        Text(value, color = colors.textPrimary, fontSize = 16.sp)
    }
}

@Composable
private fun MenuItem(icon: ImageVector, label: String, onClick: () -> Unit) {
    val colors = VisvineTheme.colors
    Row(
        modifier = Modifier.fillMaxWidth().clickable { onClick() }.padding(vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(icon, contentDescription = null, tint = colors.textSecondary, modifier = Modifier.size(24.dp))
        Text(label, color = colors.textSecondary, fontSize = 16.sp, modifier = Modifier.weight(1f))
        Icon(Icons.Filled.ChevronRight, contentDescription = null, tint = colors.textMuted, modifier = Modifier.size(20.dp))
    }
}
