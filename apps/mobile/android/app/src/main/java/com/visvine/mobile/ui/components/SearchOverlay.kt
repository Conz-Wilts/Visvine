package com.visvine.mobile.ui.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.visvine.mobile.ui.icons.AppIcons
import com.visvine.mobile.ui.theme.VVFontSize
import com.visvine.mobile.ui.theme.VVSpace
import com.visvine.mobile.ui.theme.VisvineTheme
import com.visvine.mobile.ui.viewmodel.SearchViewModel


/** A floating search bar, raised over the current screen from the bottom. */
@Composable
fun SearchOverlay(searchViewModel: SearchViewModel) {
    val isOpen by searchViewModel.isOpen.collectAsStateWithLifecycle()
    if (!isOpen) return

    val colors = VisvineTheme.colors
    val query by searchViewModel.query.collectAsStateWithLifecycle()
    val placeholder by searchViewModel.placeholder.collectAsStateWithLifecycle()
    val focusRequester = remember { FocusRequester() }

    LaunchedEffect(Unit) { focusRequester.requestFocus() }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .imePadding()
            .navigationBarsPadding(),
        contentAlignment = Alignment.BottomCenter,
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = VVSpace.x4, vertical = VVSpace.x5),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(VVSpace.x2_5),
        ) {
            Row(
                modifier = Modifier
                    .weight(1f)
                    .height(64.dp)
                    .glassSurface(32.dp)
                    .padding(start = VVSpace.x5, end = VVSpace.x2),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(VVSpace.x2_5),
            ) {
                Icon(AppIcons.Search, contentDescription = null, tint = Color.Black)
                TextField(
                    value = query,
                    onValueChange = searchViewModel::setQuery,
                    placeholder = { Text(placeholder, color = colors.fgMuted) },
                    singleLine = true,
                    textStyle = LocalTextStyle.current.copy(color = colors.fg, fontSize = VVFontSize.s16),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                    keyboardActions = KeyboardActions(onSearch = { searchViewModel.close() }),
                    colors = TextFieldDefaults.colors(
                        focusedContainerColor = Color.Transparent,
                        unfocusedContainerColor = Color.Transparent,
                        disabledContainerColor = Color.Transparent,
                        focusedIndicatorColor = Color.Transparent,
                        unfocusedIndicatorColor = Color.Transparent,
                        cursorColor = colors.accent,
                    ),
                    modifier = Modifier.weight(1f).focusRequester(focusRequester),
                )
            }

            Box(
                modifier = Modifier
                    .size(64.dp)
                    .glassSurface(32.dp)
                    .clickable { searchViewModel.close() },
                contentAlignment = Alignment.Center,
            ) {
                Icon(AppIcons.Close, contentDescription = "Close search", tint = Color.Black, modifier = Modifier.size(26.dp))
            }
        }
    }
}
