package com.visvine.mobile.ui.screens.directory

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.visvine.mobile.data.model.DirectoryMember
import com.visvine.mobile.ui.components.EmptyState
import com.visvine.mobile.ui.components.ScreenHeader
import com.visvine.mobile.ui.icons.AppIcons
import com.visvine.mobile.ui.theme.VVFontSize
import com.visvine.mobile.ui.theme.VVRadius
import com.visvine.mobile.ui.theme.VVSpace
import com.visvine.mobile.ui.theme.VVTypeColor
import com.visvine.mobile.ui.theme.VisvineTheme
import com.visvine.mobile.ui.viewmodel.DirectoryViewModel
import com.visvine.mobile.ui.viewmodel.SearchViewModel
import com.visvine.mobile.ui.viewmodel.SortOrder


private fun typeColor(type: String): Color = VVTypeColor.named(type).base
private fun capitalize(s: String) = s.replaceFirstChar { it.uppercase() }

private enum class Dropdown { TYPE, TAG }

/** Everyone and everything in the space, as the grid of cards NodeCard.tsx draws. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DirectoryScreen(
    onProfileClick: () -> Unit,
    onOpenProfile: (personId: String, name: String?) -> Unit,
    viewModel: DirectoryViewModel = hiltViewModel(),
    searchViewModel: SearchViewModel = hiltViewModel(),
) {
    val colors = VisvineTheme.colors
    val state by viewModel.state.collectAsStateWithLifecycle()
    val members by viewModel.filtered.collectAsStateWithLifecycle()
    val selectedTypes by viewModel.selectedTypes.collectAsStateWithLifecycle()
    val selectedTags by viewModel.selectedTags.collectAsStateWithLifecycle()
    val sortOrder by viewModel.sortOrder.collectAsStateWithLifecycle()
    val hasFilters by viewModel.hasFilters.collectAsStateWithLifecycle()
    val presentTypes by viewModel.presentTypes.collectAsStateWithLifecycle()
    val presentTags by viewModel.presentTags.collectAsStateWithLifecycle()

    var openDropdown by remember { mutableStateOf<Dropdown?>(null) }

    LaunchedEffect(Unit) { searchViewModel.setPlaceholder("Search directory") }

    Column(modifier = Modifier.fillMaxSize().background(colors.surface)) {
        ScreenHeader(onProfileClick = onProfileClick)

        if (state.loading) {
            Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator(color = colors.accent) }
        } else {
            PullToRefreshBox(
                isRefreshing = state.refreshing,
                onRefresh = { viewModel.refresh() },
                modifier = Modifier.fillMaxSize(),
            ) {
                LazyVerticalGrid(
                    columns = GridCells.Fixed(2),
                    contentPadding = PaddingValues(16.dp),
                    horizontalArrangement = Arrangement.spacedBy(VVSpace.x4),
                    verticalArrangement = Arrangement.spacedBy(VVSpace.x4),
                    modifier = Modifier.fillMaxSize(),
                ) {
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        Column {
                            state.error?.let {
                                Text(it, color = colors.danger, fontSize = VVFontSize.s14, modifier = Modifier.fillMaxWidth().padding(vertical = VVSpace.x3))
                                Spacer(Modifier.height(8.dp))
                            }
                            FiltersRow(
                                selectedTypes = selectedTypes,
                                selectedTags = selectedTags,
                                sortOrder = sortOrder,
                                hasFilters = hasFilters,
                                onOpenType = { openDropdown = Dropdown.TYPE },
                                onOpenTag = { openDropdown = Dropdown.TAG },
                                onToggleSort = { viewModel.toggleSort() },
                                onClear = { viewModel.clearFilters() },
                            )
                        }
                    }

                    if (members.isEmpty()) {
                        item(span = { GridItemSpan(maxLineSpan) }) {
                            EmptyState(
                                text = if (hasFilters) "No members match filters" else "No members found",
                                icon = AppIcons.People,
                                actionLabel = if (hasFilters) "Clear filters" else null,
                                onAction = if (hasFilters) ({ viewModel.clearFilters() }) else null,
                            )
                        }
                    } else {
                        items(members, key = { it.id }) { member ->
                            MemberCard(member, onOpenProfile)
                        }
                    }
                }
            }
        }
    }

    if (openDropdown != null) {
        val isType = openDropdown == Dropdown.TYPE
        val values = if (isType) presentTypes else presentTags
        val selected = if (isType) selectedTypes else selectedTags
        ModalBottomSheet(onDismissRequest = { openDropdown = null }, containerColor = colors.surface) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = VVSpace.x4, vertical = VVSpace.x2),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(if (isType) "Filter by Type" else "Filter by Tag", color = colors.fg, fontWeight = FontWeight.Bold, fontSize = VVFontSize.s16)
                Icon(AppIcons.Close, contentDescription = "Close", tint = colors.fgMuted, modifier = Modifier.size(22.dp).clickable { openDropdown = null })
            }
            if (values.isEmpty()) {
                Text("None available", color = colors.fgMuted, modifier = Modifier.padding(VVSpace.x6), textAlign = TextAlign.Center)
            } else {
                values.forEach { value ->
                    val active = value in selected
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { if (isType) viewModel.toggleType(value) else viewModel.toggleTag(value) }
                            .padding(horizontal = VVSpace.x4, vertical = VVSpace.x3_5),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Text(if (isType) capitalize(value) else value, color = colors.fg, fontSize = VVFontSize.s15, fontWeight = FontWeight.Medium)
                        Icon(
                            if (active) AppIcons.CheckSquare else AppIcons.EmptySquare,
                            contentDescription = null,
                            tint = if (active) colors.accent else colors.fgMuted,
                            modifier = Modifier.size(22.dp),
                        )
                    }
                }
            }
            Row(
                modifier = Modifier.fillMaxWidth().padding(VVSpace.x4),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    "Clear",
                    color = colors.fgMuted,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.clickable { if (isType) viewModel.clearTypes() else viewModel.clearTags() }.padding(VVSpace.x3),
                )
                Text(
                    "Done",
                    color = Color.White,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.clip(RoundedCornerShape(VVRadius.lg)).background(colors.accent).clickable { openDropdown = null }.padding(horizontal = VVSpace.x5, vertical = VVSpace.x2_5),
                )
            }
        }
    }
}

@Composable
private fun FiltersRow(
    selectedTypes: Set<String>,
    selectedTags: Set<String>,
    sortOrder: SortOrder,
    hasFilters: Boolean,
    onOpenType: () -> Unit,
    onOpenTag: () -> Unit,
    onToggleSort: () -> Unit,
    onClear: () -> Unit,
) {
    val colors = VisvineTheme.colors
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = VVSpace.x3),
        horizontalArrangement = Arrangement.spacedBy(VVSpace.x2),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        DropdownButton("Type", selectedTypes.size, onOpenType)
        DropdownButton("Tag", selectedTags.size, onOpenTag)
        Row(
            modifier = Modifier
                .clip(RoundedCornerShape(VVRadius.lg))
                .clickable { onToggleSort() }
                .padding(horizontal = VVSpace.x2_5, vertical = VVSpace.x2),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(VVSpace.x1_5),
        ) {
            Icon(
                if (sortOrder == SortOrder.AZ) AppIcons.ArrowDown else AppIcons.ArrowUp,
                contentDescription = null, tint = colors.fgSecondary, modifier = Modifier.size(14.dp),
            )
            Text(if (sortOrder == SortOrder.AZ) "A–Z" else "Z–A", color = colors.fgSecondary, fontSize = VVFontSize.s13, fontWeight = FontWeight.SemiBold)
        }
        if (hasFilters) {
            Row(
                modifier = Modifier.clickable { onClear() }.padding(horizontal = VVSpace.x2_5, vertical = VVSpace.x1_5),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(VVSpace.x1),
            ) {
                Icon(AppIcons.Close, contentDescription = null, tint = colors.fgMuted, modifier = Modifier.size(14.dp))
                Text("Clear", color = colors.fgMuted, fontSize = VVFontSize.s12, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

/**
 * A filter trigger, drawn the way DirectoryToolbar draws one: no border, nothing
 * filled — an applied filter simply speaks in the accent's dark shade.
 */
@Composable
private fun DropdownButton(label: String, count: Int, onClick: () -> Unit) {
    val colors = VisvineTheme.colors
    val active = count > 0
    val tint = if (active) colors.accentStrong else colors.fgSecondary
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(VVRadius.lg))
            .clickable { onClick() }
            .padding(horizontal = VVSpace.x2_5, vertical = VVSpace.x2),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(VVSpace.x1_5),
    ) {
        Text(
            label + if (active) " · $count" else "",
            color = tint,
            fontSize = VVFontSize.s13,
            fontWeight = FontWeight.SemiBold,
        )
        Icon(AppIcons.ChevronDown, contentDescription = null, tint = tint, modifier = Modifier.size(14.dp))
    }
}

@Composable
private fun MemberCard(member: DirectoryMember, onOpenProfile: (String, String?) -> Unit) {
    val colors = VisvineTheme.colors
    val color = typeColor(member.type)
    val isPerson = member.type.lowercase() == "person"
    val subtitle = member.subtitle ?: member.title
    val initials = member.name.split(" ").mapNotNull { it.firstOrNull() }.joinToString("").take(2).uppercase()

    Column(
        modifier = Modifier
            .clip(RoundedCornerShape(VVRadius.xl2))
            .background(colors.surface)
            .border(4.dp, color, RoundedCornerShape(VVRadius.xl2))
            .clickable(enabled = isPerson) { onOpenProfile(member.id, member.name) },
    ) {
        Box(modifier = Modifier.fillMaxWidth().aspectRatio(1f)) {
            if (!member.imageUrl.isNullOrEmpty()) {
                AsyncImage(model = member.imageUrl, contentDescription = member.name, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
            } else {
                Box(Modifier.fillMaxSize().background(color), contentAlignment = Alignment.Center) {
                    Text(initials, color = Color.White, fontSize = VVFontSize.s24, fontWeight = FontWeight.Bold)
                }
            }
        }
        Column(
            modifier = Modifier.fillMaxWidth().padding(start = VVSpace.x3, end = VVSpace.x3, top = VVSpace.x3, bottom = VVSpace.x4),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(member.name, color = colors.fg, fontSize = VVFontSize.s16, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center, maxLines = 1, overflow = TextOverflow.Ellipsis)
            // Two lines are always reserved so the chips sit on one baseline
            // across the row whether or not an entry has a tagline.
            Text(
                subtitle.orEmpty(),
                color = colors.fgSecondary,
                fontSize = VVFontSize.s13,
                textAlign = TextAlign.Center,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = VVSpace.x1_5).height(35.dp),
            )
            Box(modifier = Modifier.padding(top = VVSpace.x3_5).clip(RoundedCornerShape(VVRadius.md)).background(color).padding(horizontal = VVSpace.x2, vertical = VVSpace.x1)) {
                Text(capitalize(member.type), color = Color.White, fontSize = VVFontSize.s11, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}
