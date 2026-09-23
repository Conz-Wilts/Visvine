package com.visvine.mobile.ui.screens.profile

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.visvine.mobile.ui.icons.AppIcons
import com.visvine.mobile.ui.theme.VVFontSize
import com.visvine.mobile.ui.theme.VVRadius
import com.visvine.mobile.ui.theme.VVSpace
import com.visvine.mobile.ui.theme.VisvineTheme
import com.visvine.mobile.ui.viewmodel.EditProfileViewModel


/**
 * Your own details, as fields on the flat surface — sections opened by a
 * hairline, no card around the group.
 */
@Composable
fun EditProfileScreen(
    onBack: () -> Unit,
    viewModel: EditProfileViewModel = hiltViewModel(),
) {
    val colors = VisvineTheme.colors
    val state by viewModel.state.collectAsStateWithLifecycle()
    var showDiscard by remember { mutableStateOf(false) }

    LaunchedEffect(state.saved) { if (state.saved) onBack() }

    val onCancel = { if (state.hasChanges) showDiscard = true else onBack() }

    Column(modifier = Modifier.fillMaxSize().background(colors.surface).imePadding()) {
        Row(
            modifier = Modifier.fillMaxWidth().background(colors.surface).statusBarsPadding().padding(horizontal = VVSpace.x1, vertical = VVSpace.x1),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onCancel) { Icon(AppIcons.ArrowLeft, contentDescription = "Back", tint = colors.accent) }
            Text("Edit Profile", color = colors.fg, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
        }

        if (state.loading) {
            Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator(color = colors.accent) }
        } else {
            Column(modifier = Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(VVSpace.x4)) {
                SectionLabel("Personal Information")
                Column(modifier = Modifier.fillMaxWidth().padding(vertical = VVSpace.x1)) {
                    Field("Name", state.form.name, "Your full name") { v -> viewModel.updateField { it.copy(name = v) } }
                    Field("Title", state.form.title, "Your job title") { v -> viewModel.updateField { it.copy(title = v) } }
                    Field("Company", state.form.company, "Your company") { v -> viewModel.updateField { it.copy(company = v) } }
                    Field("Location", state.form.location, "City, Country") { v -> viewModel.updateField { it.copy(location = v) } }
                }

                SectionLabel("Contact Information")
                Column(modifier = Modifier.fillMaxWidth().padding(vertical = VVSpace.x1)) {
                    Field("Email", state.form.email, "", enabled = false) {}
                    Text("Email cannot be changed", color = colors.fgSubtle, fontSize = VVFontSize.s12, modifier = Modifier.padding(top = VVSpace.x1))
                }
            }

            // Footer
            Row(
                modifier = Modifier.fillMaxWidth().background(colors.surface).navigationBarsPadding().padding(VVSpace.x4),
                horizontalArrangement = Arrangement.spacedBy(VVSpace.x3),
            ) {
                Box(
                    modifier = Modifier.weight(1f).clip(RoundedCornerShape(VVRadius.lg)).background(colors.surfaceSubtle).clickable { onCancel() }.padding(vertical = VVSpace.x3_5),
                    contentAlignment = Alignment.Center,
                ) { Text("Cancel", color = colors.fgSecondary, fontWeight = FontWeight.Medium, fontSize = VVFontSize.s15) }

                val canSave = state.hasChanges && !state.saving
                Box(
                    modifier = Modifier.weight(1f).clip(RoundedCornerShape(VVRadius.lg)).background(if (canSave) colors.accent else colors.accent.copy(alpha = 0.5f)).clickable(enabled = canSave) { viewModel.save() }.padding(vertical = VVSpace.x3_5),
                    contentAlignment = Alignment.Center,
                ) {
                    if (state.saving) CircularProgressIndicator(color = Color.White, strokeWidth = 2.dp, modifier = Modifier.padding(VVSpace.x0_5))
                    else Text("Save Changes", color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = VVFontSize.s15)
                }
            }
        }
    }

    if (showDiscard) {
        AlertDialog(
            onDismissRequest = { showDiscard = false },
            title = { Text("Discard Changes?") },
            text = { Text("You have unsaved changes. Are you sure you want to discard them?") },
            confirmButton = { TextButton(onClick = { showDiscard = false; onBack() }) { Text("Discard", color = colors.danger) } },
            dismissButton = { TextButton(onClick = { showDiscard = false }) { Text("Keep Editing") } },
        )
    }

    state.error?.let { err ->
        AlertDialog(
            onDismissRequest = { viewModel.consumeError() },
            title = { Text("Error") },
            text = { Text(err) },
            confirmButton = { TextButton(onClick = { viewModel.consumeError() }) { Text("OK") } },
        )
    }
}

@Composable
private fun SectionLabel(text: String) {
    val colors = VisvineTheme.colors
    Text(text.uppercase(), color = colors.fgMuted, fontSize = VVFontSize.s13, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = VVSpace.x5, bottom = VVSpace.x2_5))
}

@Composable
private fun Field(label: String, value: String, placeholder: String, enabled: Boolean = true, onChange: (String) -> Unit) {
    val colors = VisvineTheme.colors
    Column(modifier = Modifier.fillMaxWidth().padding(bottom = VVSpace.x4)) {
        Text(label, color = colors.fgSecondary, fontSize = VVFontSize.s14, fontWeight = FontWeight.Medium, modifier = Modifier.padding(bottom = VVSpace.x1_5))
        OutlinedTextField(
            value = value,
            onValueChange = onChange,
            enabled = enabled,
            placeholder = { Text(placeholder, color = colors.fgSubtle) },
            singleLine = true,
            shape = RoundedCornerShape(VVRadius.xl),
            modifier = Modifier.fillMaxWidth(),
            colors = OutlinedTextFieldDefaults.colors(
                focusedTextColor = colors.fg,
                unfocusedTextColor = colors.fg,
                disabledTextColor = colors.fgSubtle,
                focusedBorderColor = colors.accent,
                unfocusedBorderColor = colors.line,
                disabledBorderColor = colors.lineSubtle,
                disabledContainerColor = colors.surfaceMuted,
                cursorColor = colors.accent,
            ),
        )
    }
}
