package com.visvine.mobile.ui.screens.settings

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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.visvine.mobile.ui.icons.AppIcons
import com.visvine.mobile.ui.theme.VVFontSize
import com.visvine.mobile.ui.theme.VVSpace
import com.visvine.mobile.ui.theme.VisvineTheme
import com.visvine.mobile.ui.viewmodel.ThemeViewModel


/** Appearance settings — the hue picker, and nothing the web app does not have. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SettingsScreen(
    onBack: () -> Unit,
    viewModel: ThemeViewModel = hiltViewModel(),
) {
    val colors = VisvineTheme.colors
    val themeId by viewModel.themeId.collectAsStateWithLifecycle()
    val activeTheme = viewModel.themes.firstOrNull { it.id == themeId } ?: viewModel.themes.first()

    Column(modifier = Modifier.fillMaxSize().background(colors.surface)) {
        Row(
            modifier = Modifier.fillMaxWidth().background(colors.surface).statusBarsPadding().padding(horizontal = VVSpace.x1, vertical = VVSpace.x1),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onBack) { Icon(AppIcons.ArrowLeft, contentDescription = "Back", tint = colors.accent) }
            Text("Settings", color = colors.fg, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
        }

        Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = VVSpace.x10)) {
            Column(modifier = Modifier.fillMaxWidth().padding(VVSpace.x4)) {
                Text("APPEARANCE", color = colors.fgMuted, fontSize = VVFontSize.s11, fontWeight = FontWeight.SemiBold, letterSpacing = 0.9.sp, modifier = Modifier.padding(bottom = VVSpace.x1))

                // Theme colour
                Row(modifier = Modifier.fillMaxWidth().padding(top = VVSpace.x3_5), verticalAlignment = Alignment.CenterVertically) {
                    Icon(AppIcons.Palette, contentDescription = null, tint = colors.accent, modifier = Modifier.size(20.dp))
                    Text("Theme Colour", color = colors.fg, fontSize = VVFontSize.s16, modifier = Modifier.padding(start = VVSpace.x3).weight(1f))
                    Text(activeTheme.name, color = colors.fgMuted, fontSize = VVFontSize.s14)
                }

                FlowRow(
                    modifier = Modifier.fillMaxWidth().padding(top = VVSpace.x4, start = VVSpace.x8),
                    horizontalArrangement = Arrangement.spacedBy(VVSpace.x4),
                    verticalArrangement = Arrangement.spacedBy(VVSpace.x3),
                ) {
                    viewModel.themes.forEach { theme ->
                        val active = themeId == theme.id
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Box(
                                modifier = Modifier
                                    .size(if (active) 36.dp else 32.dp)
                                    .clip(CircleShape)
                                    .background(theme.light.base)
                                    .then(if (active) Modifier.border(2.dp, theme.light.strong, CircleShape) else Modifier)
                                    .clickable { viewModel.setTheme(theme.id) },
                                contentAlignment = Alignment.Center,
                            ) {
                                if (active) Icon(AppIcons.Check, contentDescription = null, tint = Color.White, modifier = Modifier.size(16.dp))
                            }
                            Text(theme.name, color = colors.fgMuted, fontSize = VVFontSize.s11, modifier = Modifier.padding(top = VVSpace.x1_5))
                        }
                    }
                }
            }
        }
    }
}
