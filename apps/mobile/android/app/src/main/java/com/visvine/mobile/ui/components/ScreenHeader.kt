package com.visvine.mobile.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.visvine.mobile.ui.icons.AppIcons
import com.visvine.mobile.ui.theme.VisvineTheme
import com.visvine.mobile.ui.viewmodel.AuthViewModel
import com.visvine.mobile.ui.viewmodel.SpaceViewModel


private fun initials(name: String?): String =
    name?.split(" ")?.mapNotNull { it.firstOrNull() }?.joinToString("")?.take(2)?.uppercase() ?: "?"

/** The header every main screen carries: space switcher, then profile avatar. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScreenHeader(
    onProfileClick: () -> Unit,
    showSpaceSelector: Boolean = true,
    spaceViewModel: SpaceViewModel = hiltViewModel(),
    authViewModel: AuthViewModel = hiltViewModel(),
) {
    val colors = VisvineTheme.colors
    val spaces by spaceViewModel.spaces.collectAsStateWithLifecycle()
    val current by spaceViewModel.current.collectAsStateWithLifecycle()
    val auth by authViewModel.state.collectAsStateWithLifecycle()

    var pickerVisible by remember { mutableStateOf(false) }

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .background(colors.bgPrimary)
            .statusBarsPadding(),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(56.dp)
                .padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            if (showSpaceSelector) {
                Box(modifier = Modifier.clickable { pickerVisible = true }) {
                    SpaceAvatar(name = current?.name ?: "", imageUrl = current?.image, size = 36.dp)
                }
            } else {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(AppIcons.Network, contentDescription = null, tint = colors.accent, modifier = Modifier.size(22.dp))
                    Text("Visvine", color = colors.textPrimary, fontSize = 18.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(start = 8.dp))
                }
            }

            val image = auth.user?.image
            Box(modifier = Modifier.size(40.dp).clip(CircleShape).clickable { onProfileClick() }, contentAlignment = Alignment.Center) {
                if (!image.isNullOrEmpty()) {
                    AsyncImage(model = image, contentDescription = "Profile", contentScale = ContentScale.Crop, modifier = Modifier.size(40.dp).clip(CircleShape))
                } else {
                    Box(modifier = Modifier.size(40.dp).clip(CircleShape).background(colors.accentLight), contentAlignment = Alignment.Center) {
                        Text(initials(auth.user?.name), color = colors.accentDark, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                    }
                }
            }
        }
    }

    if (pickerVisible) {
        ModalBottomSheet(
            onDismissRequest = { pickerVisible = false },
            containerColor = colors.bgPrimary,
        ) {
            Text(
                "Space",
                color = colors.textMuted,
                fontWeight = FontWeight.SemiBold,
                fontSize = 13.sp,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
            )
            LazyColumn {
                items(spaces, key = { it.id }) { space ->
                    val active = current?.id == space.id
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(if (active) colors.accentLight else Color.Transparent)
                            .clickable {
                                spaceViewModel.setCurrent(space)
                                pickerVisible = false
                            }
                            .padding(horizontal = 16.dp, vertical = 14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        SpaceAvatar(name = space.name, imageUrl = space.image, size = 28.dp)
                        Text(
                            space.name,
                            color = if (active) colors.accentDark else colors.textSecondary,
                            fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal,
                            fontSize = 16.sp,
                            modifier = Modifier.weight(1f),
                        )
                        if (active) Icon(AppIcons.Check, contentDescription = null, tint = colors.accent, modifier = Modifier.size(18.dp))
                    }
                }
            }
        }
    }
}
