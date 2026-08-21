package com.visvine.mobile.ui.navigation

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.visvine.mobile.ui.components.glassSurface
import com.visvine.mobile.ui.icons.AppIcons
import com.visvine.mobile.ui.theme.VisvineTheme


// One icon per tab, not a filled/outline pair: our glyphs are stroke-only (see
// docs/icons.md), and focus is already carried by the accent colour on the whole
// cell — which was doing most of the work anyway.
//
// The icon is a lambda rather than a Painter because `AppIcons` properties are
// @Composable getters (they resolve a drawable against the current context), so
// they cannot be evaluated in a top-level `val`.
private data class TabMeta(
    val route: String,
    val label: String,
    val icon: @Composable () -> Painter,
)

private val TABS = listOf(
    TabMeta(Routes.DIRECTORY, "Directory") { AppIcons.People },
    TabMeta(Routes.MESSAGES, "Messages") { AppIcons.Message },
    TabMeta(Routes.EVENTS, "Events") { AppIcons.Calendar },
)

/**
 * The bespoke glass pill tab bar: one row of tabs, selected by tap, with a
 * search circle sitting to the right of the pill.
 */
@Composable
fun GlassTabBar(
    current: String,
    onSelect: (String) -> Unit,
    onSearch: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = VisvineTheme.colors
    val neutral = Color.Black

    Row(
        modifier = modifier
            .navigationBarsPadding()
            .padding(start = 16.dp, end = 16.dp, bottom = 20.dp)
            .fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(
            modifier = Modifier
                .weight(1f)
                .height(64.dp)
                .glassSurface(32.dp)
                .padding(horizontal = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TABS.forEach { tab ->
                val focused = current == tab.route
                val tint = if (focused) colors.accent else neutral
                Column(
                    modifier = Modifier
                        .weight(1f)
                        .clickable { onSelect(tab.route) }
                        .padding(vertical = 6.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    Icon(
                        painter = tab.icon(),
                        contentDescription = tab.label,
                        tint = tint,
                        modifier = Modifier.size(22.dp),
                    )
                    Text(tab.label, color = tint, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                }
            }
        }

        Box(
            modifier = Modifier
                .size(64.dp)
                .glassSurface(32.dp)
                .clickable { onSearch() },
            contentAlignment = Alignment.Center,
        ) {
            Icon(AppIcons.Search, contentDescription = "Search", tint = neutral, modifier = Modifier.size(30.dp))
        }
    }
}
