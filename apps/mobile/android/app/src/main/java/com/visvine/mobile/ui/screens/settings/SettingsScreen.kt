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

    Column(modifier = Modifier.fillMaxSize().background(colors.bgPrimary)) {
        Row(
            modifier = Modifier.fillMaxWidth().background(colors.bgPrimary).statusBarsPadding().padding(horizontal = 4.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onBack) { Icon(AppIcons.ArrowLeft, contentDescription = "Back", tint = colors.accent) }
            Text("Settings", color = colors.textPrimary, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
        }

        Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = 40.dp)) {
            Column(modifier = Modifier.fillMaxWidth().padding(16.dp)) {
                Text("APPEARANCE", color = colors.textMuted, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.9.sp, modifier = Modifier.padding(bottom = 4.dp))

                // Theme colour
                Row(modifier = Modifier.fillMaxWidth().padding(top = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(AppIcons.Palette, contentDescription = null, tint = colors.accent, modifier = Modifier.size(20.dp))
                    Text("Theme Colour", color = colors.textPrimary, fontSize = 16.sp, modifier = Modifier.padding(start = 12.dp).weight(1f))
                    Text(activeTheme.name, color = colors.textMuted, fontSize = 14.sp)
                }

                FlowRow(
                    modifier = Modifier.fillMaxWidth().padding(top = 16.dp, start = 32.dp),
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    viewModel.themes.forEach { theme ->
                        val active = themeId == theme.id
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Box(
                                modifier = Modifier
                                    .size(if (active) 36.dp else 32.dp)
                                    .clip(CircleShape)
                                    .background(theme.accent)
                                    .then(if (active) Modifier.border(2.dp, theme.accentDark, CircleShape) else Modifier)
                                    .clickable { viewModel.setTheme(theme.id) },
                                contentAlignment = Alignment.Center,
                            ) {
                                if (active) Icon(AppIcons.Check, contentDescription = null, tint = Color.White, modifier = Modifier.size(16.dp))
                            }
                            Text(theme.name, color = colors.textMuted, fontSize = 11.sp, modifier = Modifier.padding(top = 6.dp))
                        }
                    }
                }
            }
        }
    }
}
