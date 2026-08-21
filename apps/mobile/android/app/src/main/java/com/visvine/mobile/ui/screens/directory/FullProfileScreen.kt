package com.visvine.mobile.ui.screens.directory

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.visvine.mobile.data.model.FullProfile
import com.visvine.mobile.ui.icons.AppIcons
import com.visvine.mobile.ui.theme.DynamicColors
import com.visvine.mobile.ui.theme.VisvineTheme
import com.visvine.mobile.ui.viewmodel.FullProfileViewModel
import java.net.URI


private fun initials(name: String): String {
    val parts = name.trim().split(Regex("\\s+"))
    return if (parts.size == 1) parts[0].take(2).uppercase()
    else (parts.first().take(1) + parts.last().take(1)).uppercase()
}

private fun safeHostname(url: String): String = try {
    URI(url).host?.removePrefix("www.") ?: url
} catch (_: Exception) { url }

private fun openUrl(context: Context, url: String) {
    runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
        .onFailure { Toast.makeText(context, "Could not open link", Toast.LENGTH_SHORT).show() }
}

/**
 * Someone else's profile: a hero, then About / Skills / Contact as blocks on the
 * flat surface, divided by hairlines.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FullProfileScreen(
    initialName: String?,
    onBack: () -> Unit,
    viewModel: FullProfileViewModel = hiltViewModel(),
) {
    val colors = VisvineTheme.colors
    val state by viewModel.state.collectAsStateWithLifecycle()
    val context = LocalContext.current

    Column(modifier = Modifier.fillMaxSize().background(colors.bgPrimary)) {
        // Top bar
        Row(
            modifier = Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Box(modifier = Modifier.size(36.dp).clip(CircleShape).clickable { onBack() }, contentAlignment = Alignment.Center) {
                Icon(AppIcons.ArrowLeft, contentDescription = "Back", tint = colors.textPrimary, modifier = Modifier.size(22.dp))
            }
            Text(
                state.profile?.name ?: initialName ?: "Profile",
                color = colors.textPrimary, fontSize = 16.sp, fontWeight = FontWeight.SemiBold,
                maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center,
                modifier = Modifier.weight(1f),
            )
            Box(Modifier.size(36.dp))
        }

        val profile = state.profile
        when {
            state.loading -> Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator(color = colors.accent) }
            profile == null -> ErrorState(state.error) { viewModel.load() }
            else -> PullToRefreshBox(
                isRefreshing = state.refreshing,
                onRefresh = { viewModel.refresh() },
                modifier = Modifier.fillMaxSize(),
            ) {
                ProfileBody(profile, viewModel.isOwner, colors, context)
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ProfileBody(profile: FullProfile, isOwner: Boolean, colors: DynamicColors, context: Context) {
    val joinedYear = profile.createdAt.take(4).toIntOrNull()
    val hasContact = listOf(profile.email, profile.phone, profile.website, profile.linkedinUrl, profile.twitterUrl).any { !it.isNullOrEmpty() }

    Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = 120.dp)) {
        // Hero
        Column(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(top = 16.dp, bottom = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Box(contentAlignment = Alignment.BottomEnd) {
                if (!profile.imageUrl.isNullOrEmpty()) {
                    AsyncImage(model = profile.imageUrl, contentDescription = profile.name, contentScale = ContentScale.Crop, modifier = Modifier.size(120.dp).clip(RoundedCornerShape(16.dp)))
                } else {
                    Box(modifier = Modifier.size(120.dp).clip(RoundedCornerShape(16.dp)).background(colors.accent), contentAlignment = Alignment.Center) {
                        Text(initials(profile.name), color = Color.White, fontSize = 40.sp, fontWeight = FontWeight.Bold)
                    }
                }
                if (profile.openToWork) {
                    Box(modifier = Modifier.size(24.dp).clip(CircleShape).background(Color(0xFF10B981)).border(3.dp, colors.bgPrimary, CircleShape), contentAlignment = Alignment.Center) {
                        Icon(AppIcons.Check, contentDescription = null, tint = Color.White, modifier = Modifier.size(12.dp))
                    }
                }
            }

            Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(profile.name, color = colors.textPrimary, fontSize = 24.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
                profile.pronouns?.let { Text("($it)", color = colors.textMuted, fontSize = 14.sp) }
            }
            profile.subtitle?.let { Text(it, color = colors.textSecondary, fontSize = 15.sp, textAlign = TextAlign.Center) }

            if (profile.openToWork) {
                Row(
                    modifier = Modifier.clip(RoundedCornerShape(6.dp)).background(colors.bgTertiary).padding(horizontal = 8.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Box(Modifier.size(6.dp).clip(CircleShape).background(colors.accent))
                    Text("Open to work", color = colors.textSecondary, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                }
            }

            FlowRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                profile.location?.let {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        Icon(AppIcons.Location, contentDescription = null, tint = colors.textMuted, modifier = Modifier.size(14.dp))
                        Text(it, color = colors.textMuted, fontSize = 13.sp)
                    }
                }
                profile.website?.let { site ->
                    Row(
                        modifier = Modifier.clickable { openUrl(context, site) },
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Icon(AppIcons.OpenInNew, contentDescription = null, tint = colors.accentDark, modifier = Modifier.size(14.dp))
                        Text(safeHostname(site), color = colors.accentDark, fontSize = 13.sp)
                    }
                }
            }

            if (!isOwner) {
                Row(modifier = Modifier.fillMaxWidth().padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(
                        modifier = Modifier.weight(1f).clip(RoundedCornerShape(8.dp)).background(colors.accent).clickable {
                            Toast.makeText(context, "Connect flow coming soon.", Toast.LENGTH_SHORT).show()
                        }.padding(vertical = 12.dp),
                        horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(AppIcons.PersonAdd, contentDescription = null, tint = Color.White, modifier = Modifier.size(16.dp))
                        Text("Connect", color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, modifier = Modifier.padding(start = 6.dp))
                    }
                    Row(
                        modifier = Modifier.weight(1f).clip(RoundedCornerShape(8.dp)).background(colors.bgSecondary).clickable {
                            if (!profile.email.isNullOrEmpty()) openUrl(context, "mailto:${profile.email}")
                            else Toast.makeText(context, "This person has not listed an email.", Toast.LENGTH_SHORT).show()
                        }.padding(vertical = 12.dp),
                        horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(AppIcons.Mail, contentDescription = null, tint = colors.textSecondary, modifier = Modifier.size(16.dp))
                        Text("Message", color = colors.textSecondary, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, modifier = Modifier.padding(start = 6.dp))
                    }
                }
            }

            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                joinedYear?.let { StatChip(AppIcons.Calendar, "Member since $it", colors) }
                if (profile.tags.isNotEmpty()) {
                    StatChip(AppIcons.Tag, "${profile.tags.size} skill${if (profile.tags.size == 1) "" else "s"}", colors)
                }
            }
        }

        if (!profile.bio.isNullOrEmpty()) {
            Section("About", colors) { Text(profile.bio!!, color = colors.textSecondary, fontSize = 14.sp) }
        }
        if (profile.tags.isNotEmpty()) {
            Section("Skills", colors) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    profile.tags.forEach { tag ->
                        Box(modifier = Modifier.clip(RoundedCornerShape(6.dp)).background(colors.bgTertiary).padding(horizontal = 8.dp, vertical = 5.dp)) {
                            Text(tag, color = colors.textSecondary, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                        }
                    }
                }
            }
        }
        if (hasContact) {
            Section("Contact", colors) {
                Column {
                    profile.email?.let { ContactRow(AppIcons.Mail, it, colors) { openUrl(context, "mailto:$it") } }
                    profile.phone?.let { ContactRow(AppIcons.Calendar, it, colors) { openUrl(context, "tel:$it") } }
                    profile.website?.let { ContactRow(AppIcons.OpenInNew, safeHostname(it), colors) { openUrl(context, it) } }
                    profile.linkedinUrl?.let { ContactRow(AppIcons.OpenInNew, "LinkedIn", colors) { openUrl(context, it) } }
                    profile.twitterUrl?.let { ContactRow(AppIcons.OpenInNew, "X / Twitter", colors) { openUrl(context, it) } }
                }
            }
        }
    }
}

@Composable
private fun StatChip(icon: Painter, label: String, colors: DynamicColors) {
    Row(
        modifier = Modifier.clip(RoundedCornerShape(6.dp)).background(colors.bgTertiary).padding(horizontal = 8.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Icon(icon, contentDescription = null, tint = colors.textMuted, modifier = Modifier.size(12.dp))
        Text(label, color = colors.textSecondary, fontSize = 12.sp, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun Section(title: String, colors: DynamicColors, content: @Composable () -> Unit) {
    Column(modifier = Modifier.fillMaxWidth()) {
        Box(Modifier.fillMaxWidth().height(1.dp).background(colors.borderSubtle))
        Text(
            title.uppercase(), color = colors.textMuted, fontSize = 11.sp,
            fontWeight = FontWeight.SemiBold, letterSpacing = 0.9.sp,
            modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 20.dp, bottom = 8.dp),
        )
        Box(modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, bottom = 20.dp)) { content() }
    }
}

@Composable
private fun ContactRow(icon: Painter, label: String, colors: DynamicColors, onClick: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().clickable { onClick() }.padding(vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(icon, contentDescription = null, tint = colors.textMuted, modifier = Modifier.size(18.dp))
        Text(label, color = colors.textSecondary, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun ErrorState(error: String?, onRetry: () -> Unit) {
    val colors = VisvineTheme.colors
    Box(Modifier.fillMaxSize().padding(24.dp), Alignment.Center) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text("Profile unavailable", color = colors.textPrimary, fontSize = 16.sp, fontWeight = FontWeight.Bold)
            Text(error ?: "This person may have been removed.", color = colors.textMuted, fontSize = 14.sp, textAlign = TextAlign.Center)
            Text(
                "Try again", color = colors.accentDark, fontSize = 14.sp, fontWeight = FontWeight.SemiBold,
                modifier = Modifier.padding(top = 8.dp).clickable { onRetry() },
            )
        }
    }
}
