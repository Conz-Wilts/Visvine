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
import com.visvine.mobile.ui.theme.VVColor
import com.visvine.mobile.ui.theme.VVFontSize
import com.visvine.mobile.ui.theme.VVRadius
import com.visvine.mobile.ui.theme.VVSpace
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

    Column(modifier = Modifier.fillMaxSize().background(colors.surface)) {
        // Top bar
        Row(
            modifier = Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = VVSpace.x3, vertical = VVSpace.x2),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(VVSpace.x2),
        ) {
            Box(modifier = Modifier.size(36.dp).clip(CircleShape).clickable { onBack() }, contentAlignment = Alignment.Center) {
                Icon(AppIcons.ArrowLeft, contentDescription = "Back", tint = colors.fg, modifier = Modifier.size(22.dp))
            }
            Text(
                state.profile?.name ?: initialName ?: "Profile",
                color = colors.fg, fontSize = VVFontSize.s16, fontWeight = FontWeight.SemiBold,
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
            modifier = Modifier.fillMaxWidth().padding(horizontal = VVSpace.x4).padding(top = VVSpace.x4, bottom = VVSpace.x6),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(VVSpace.x3),
        ) {
            Box(contentAlignment = Alignment.BottomEnd) {
                if (!profile.imageUrl.isNullOrEmpty()) {
                    AsyncImage(model = profile.imageUrl, contentDescription = profile.name, contentScale = ContentScale.Crop, modifier = Modifier.size(120.dp).clip(RoundedCornerShape(VVRadius.xl2)))
                } else {
                    Box(modifier = Modifier.size(120.dp).clip(RoundedCornerShape(VVRadius.xl2)).background(colors.accent), contentAlignment = Alignment.Center) {
                        Text(initials(profile.name), color = Color.White, fontSize = 40.sp, fontWeight = FontWeight.Bold)
                    }
                }
                if (profile.openToWork) {
                    Box(modifier = Modifier.size(24.dp).clip(CircleShape).background(VVColor.successBright).border(3.dp, colors.surface, CircleShape), contentAlignment = Alignment.Center) {
                        Icon(AppIcons.Check, contentDescription = null, tint = Color.White, modifier = Modifier.size(12.dp))
                    }
                }
            }

            Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(VVSpace.x1_5)) {
                Text(profile.name, color = colors.fg, fontSize = VVFontSize.s24, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
                profile.pronouns?.let { Text("($it)", color = colors.fgMuted, fontSize = VVFontSize.s14) }
            }
            profile.subtitle?.let { Text(it, color = colors.fgSecondary, fontSize = VVFontSize.s15, textAlign = TextAlign.Center) }

            if (profile.openToWork) {
                Row(
                    modifier = Modifier.clip(RoundedCornerShape(VVRadius.md)).background(colors.surfaceMuted).padding(horizontal = VVSpace.x2, vertical = VVSpace.x1),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(VVSpace.x1_5),
                ) {
                    Box(Modifier.size(6.dp).clip(CircleShape).background(colors.accent))
                    Text("Open to work", color = colors.fgSecondary, fontSize = VVFontSize.s12, fontWeight = FontWeight.SemiBold)
                }
            }

            FlowRow(horizontalArrangement = Arrangement.spacedBy(VVSpace.x3)) {
                profile.location?.let {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(VVSpace.x1)) {
                        Icon(AppIcons.Location, contentDescription = null, tint = colors.fgMuted, modifier = Modifier.size(14.dp))
                        Text(it, color = colors.fgMuted, fontSize = VVFontSize.s13)
                    }
                }
                profile.website?.let { site ->
                    Row(
                        modifier = Modifier.clickable { openUrl(context, site) },
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(VVSpace.x1),
                    ) {
                        Icon(AppIcons.OpenInNew, contentDescription = null, tint = colors.accentStrong, modifier = Modifier.size(14.dp))
                        Text(safeHostname(site), color = colors.accentStrong, fontSize = VVFontSize.s13)
                    }
                }
            }

            if (!isOwner) {
                Row(modifier = Modifier.fillMaxWidth().padding(top = VVSpace.x1), horizontalArrangement = Arrangement.spacedBy(VVSpace.x2)) {
                    Row(
                        modifier = Modifier.weight(1f).clip(RoundedCornerShape(VVRadius.lg)).background(colors.accent).clickable {
                            Toast.makeText(context, "Connect flow coming soon.", Toast.LENGTH_SHORT).show()
                        }.padding(vertical = VVSpace.x3),
                        horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(AppIcons.PersonAdd, contentDescription = null, tint = Color.White, modifier = Modifier.size(16.dp))
                        Text("Connect", color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = VVFontSize.s14, modifier = Modifier.padding(start = VVSpace.x1_5))
                    }
                    Row(
                        modifier = Modifier.weight(1f).clip(RoundedCornerShape(VVRadius.lg)).background(colors.surfaceSubtle).clickable {
                            if (!profile.email.isNullOrEmpty()) openUrl(context, "mailto:${profile.email}")
                            else Toast.makeText(context, "This person has not listed an email.", Toast.LENGTH_SHORT).show()
                        }.padding(vertical = VVSpace.x3),
                        horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(AppIcons.Mail, contentDescription = null, tint = colors.fgSecondary, modifier = Modifier.size(16.dp))
                        Text("Message", color = colors.fgSecondary, fontWeight = FontWeight.SemiBold, fontSize = VVFontSize.s14, modifier = Modifier.padding(start = VVSpace.x1_5))
                    }
                }
            }

            FlowRow(horizontalArrangement = Arrangement.spacedBy(VVSpace.x1_5)) {
                joinedYear?.let { StatChip(AppIcons.Calendar, "Member since $it", colors) }
                if (profile.tags.isNotEmpty()) {
                    StatChip(AppIcons.Tag, "${profile.tags.size} skill${if (profile.tags.size == 1) "" else "s"}", colors)
                }
            }
        }

        if (!profile.bio.isNullOrEmpty()) {
            Section("About", colors) { Text(profile.bio!!, color = colors.fgSecondary, fontSize = VVFontSize.s14) }
        }
        if (profile.tags.isNotEmpty()) {
            Section("Skills", colors) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(VVSpace.x1_5), verticalArrangement = Arrangement.spacedBy(VVSpace.x1_5)) {
                    profile.tags.forEach { tag ->
                        Box(modifier = Modifier.clip(RoundedCornerShape(VVRadius.md)).background(colors.surfaceMuted).padding(horizontal = VVSpace.x2, vertical = 5.dp)) {
                            Text(tag, color = colors.fgSecondary, fontSize = VVFontSize.s11, fontWeight = FontWeight.SemiBold)
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
        modifier = Modifier.clip(RoundedCornerShape(VVRadius.md)).background(colors.surfaceMuted).padding(horizontal = VVSpace.x2, vertical = VVSpace.x1),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(VVSpace.x1),
    ) {
        Icon(icon, contentDescription = null, tint = colors.fgMuted, modifier = Modifier.size(12.dp))
        Text(label, color = colors.fgSecondary, fontSize = VVFontSize.s12, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun Section(title: String, colors: DynamicColors, content: @Composable () -> Unit) {
    Column(modifier = Modifier.fillMaxWidth()) {
        Box(Modifier.fillMaxWidth().height(1.dp).background(colors.lineSubtle))
        Text(
            title.uppercase(), color = colors.fgMuted, fontSize = VVFontSize.s11,
            fontWeight = FontWeight.SemiBold, letterSpacing = 0.9.sp,
            modifier = Modifier.padding(start = VVSpace.x4, end = VVSpace.x4, top = VVSpace.x5, bottom = VVSpace.x2),
        )
        Box(modifier = Modifier.fillMaxWidth().padding(start = VVSpace.x4, end = VVSpace.x4, bottom = VVSpace.x5)) { content() }
    }
}

@Composable
private fun ContactRow(icon: Painter, label: String, colors: DynamicColors, onClick: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().clickable { onClick() }.padding(vertical = VVSpace.x2_5),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(VVSpace.x3),
    ) {
        Icon(icon, contentDescription = null, tint = colors.fgMuted, modifier = Modifier.size(18.dp))
        Text(label, color = colors.fgSecondary, fontSize = VVFontSize.s14, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun ErrorState(error: String?, onRetry: () -> Unit) {
    val colors = VisvineTheme.colors
    Box(Modifier.fillMaxSize().padding(VVSpace.x6), Alignment.Center) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(VVSpace.x2),
        ) {
            Text("Profile unavailable", color = colors.fg, fontSize = VVFontSize.s16, fontWeight = FontWeight.Bold)
            Text(error ?: "This person may have been removed.", color = colors.fgMuted, fontSize = VVFontSize.s14, textAlign = TextAlign.Center)
            Text(
                "Try again", color = colors.accentStrong, fontSize = VVFontSize.s14, fontWeight = FontWeight.SemiBold,
                modifier = Modifier.padding(top = VVSpace.x2).clickable { onRetry() },
            )
        }
    }
}
