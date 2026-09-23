package com.visvine.mobile.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.visvine.mobile.ui.theme.VVFontSize
import com.visvine.mobile.ui.theme.VVRadius
import com.visvine.mobile.ui.theme.VVSpace
import com.visvine.mobile.ui.theme.VisvineTheme

/**
 * Two or three names in a row on `bgTertiary`, the chosen one painted
 * `bgPrimary` — the segmented switch between the views of one screen. Rounded
 * squares, no pill, no shadow.
 */
@Composable
fun SegmentedNav(
    items: List<String>,
    selected: Int,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = VisvineTheme.colors
    Row(
        modifier = modifier
            .fillMaxWidth()
            .height(36.dp)
            .clip(RoundedCornerShape(VVRadius.lg))
            .background(colors.surfaceMuted)
            .padding(VVSpace.x0_5),
    ) {
        items.forEachIndexed { index, label ->
            val active = index == selected
            Box(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxHeight()
                    .clip(RoundedCornerShape(VVRadius.md))
                    .background(if (active) colors.surface else colors.surfaceMuted)
                    .clickable { onSelect(index) },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    label,
                    color = if (active) colors.fg else colors.fgMuted,
                    fontSize = VVFontSize.s14,
                    fontWeight = FontWeight.SemiBold,
                )
            }
        }
    }
}
