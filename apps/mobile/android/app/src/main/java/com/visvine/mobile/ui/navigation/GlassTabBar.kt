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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.PeopleOutline
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.visvine.mobile.ui.components.glassSurface
import com.visvine.mobile.ui.theme.VisvineTheme

private data class TabMeta(
    val route: String,
    val label: String,
    val filled: ImageVector,
    val outline: ImageVector,
)

private val TABS = listOf(
    TabMeta(Routes.DIRECTORY, "Directory", Icons.Filled.People, Icons.Outlined.PeopleOutline),
    TabMeta(Routes.MESSAGES, "Messages", Icons.Filled.Chat, Icons.Outlined.ChatBubbleOutline),
    TabMeta(Routes.EVENTS, "Events", Icons.Filled.CalendarMonth, Icons.Outlined.CalendarMonth),
)

/**
 * Port of navigation/TabNavigator.tsx's bespoke glass pill bar (the RN swipe
 * PanResponder is dropped in favour of standard taps per the B2 custom-UI
 * decision). A search circle sits to the right of the pill.
 */
@Composable
fun GlassTabBar(
    isDark: Boolean,
    current: String,
    onSelect: (String) -> Unit,
    onSearch: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = VisvineTheme.colors
    val neutral = if (isDark) Color.White else Color.Black

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
                .glassSurface(isDark, 32.dp)
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
                        imageVector = if (focused) tab.filled else tab.outline,
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
                .glassSurface(isDark, 32.dp)
                .clickable { onSearch() },
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Filled.Search, contentDescription = "Search", tint = neutral, modifier = Modifier.size(30.dp))
        }
    }
}
