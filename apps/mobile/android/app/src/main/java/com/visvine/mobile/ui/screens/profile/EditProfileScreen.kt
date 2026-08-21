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

    Column(modifier = Modifier.fillMaxSize().background(colors.bgPrimary).imePadding()) {
        Row(
            modifier = Modifier.fillMaxWidth().background(colors.bgPrimary).statusBarsPadding().padding(horizontal = 4.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onCancel) { Icon(AppIcons.ArrowLeft, contentDescription = "Back", tint = colors.accent) }
            Text("Edit Profile", color = colors.textPrimary, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
        }

        if (state.loading) {
            Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator(color = colors.accent) }
        } else {
            Column(modifier = Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(16.dp)) {
                SectionLabel("Personal Information")
                Column(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                    Field("Name", state.form.name, "Your full name") { v -> viewModel.updateField { it.copy(name = v) } }
                    Field("Title", state.form.title, "Your job title") { v -> viewModel.updateField { it.copy(title = v) } }
                    Field("Company", state.form.company, "Your company") { v -> viewModel.updateField { it.copy(company = v) } }
                    Field("Location", state.form.location, "City, Country") { v -> viewModel.updateField { it.copy(location = v) } }
                }

                SectionLabel("Contact Information")
                Column(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                    Field("Email", state.form.email, "", enabled = false) {}
                    Text("Email cannot be changed", color = colors.textLight, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp))
                }
            }

            // Footer
            Row(
                modifier = Modifier.fillMaxWidth().background(colors.bgPrimary).navigationBarsPadding().padding(16.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Box(
                    modifier = Modifier.weight(1f).clip(RoundedCornerShape(8.dp)).background(colors.bgSecondary).clickable { onCancel() }.padding(vertical = 14.dp),
                    contentAlignment = Alignment.Center,
                ) { Text("Cancel", color = colors.textSecondary, fontWeight = FontWeight.Medium, fontSize = 15.sp) }

                val canSave = state.hasChanges && !state.saving
                Box(
                    modifier = Modifier.weight(1f).clip(RoundedCornerShape(8.dp)).background(if (canSave) colors.accent else colors.accent.copy(alpha = 0.5f)).clickable(enabled = canSave) { viewModel.save() }.padding(vertical = 14.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    if (state.saving) CircularProgressIndicator(color = Color.White, strokeWidth = 2.dp, modifier = Modifier.padding(2.dp))
                    else Text("Save Changes", color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                }
            }
        }
    }

    if (showDiscard) {
        AlertDialog(
            onDismissRequest = { showDiscard = false },
            title = { Text("Discard Changes?") },
            text = { Text("You have unsaved changes. Are you sure you want to discard them?") },
            confirmButton = { TextButton(onClick = { showDiscard = false; onBack() }) { Text("Discard", color = colors.error) } },
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
    Text(text.uppercase(), color = colors.textMuted, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 20.dp, bottom = 10.dp))
}

@Composable
private fun Field(label: String, value: String, placeholder: String, enabled: Boolean = true, onChange: (String) -> Unit) {
    val colors = VisvineTheme.colors
    Column(modifier = Modifier.fillMaxWidth().padding(bottom = 16.dp)) {
        Text(label, color = colors.textSecondary, fontSize = 14.sp, fontWeight = FontWeight.Medium, modifier = Modifier.padding(bottom = 6.dp))
        OutlinedTextField(
            value = value,
            onValueChange = onChange,
            enabled = enabled,
            placeholder = { Text(placeholder, color = colors.textLight) },
            singleLine = true,
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier.fillMaxWidth(),
            colors = OutlinedTextFieldDefaults.colors(
                focusedTextColor = colors.textPrimary,
                unfocusedTextColor = colors.textPrimary,
                disabledTextColor = colors.textLight,
                focusedBorderColor = colors.accent,
                unfocusedBorderColor = colors.borderDefault,
                disabledBorderColor = colors.borderLight,
                disabledContainerColor = colors.bgTertiary,
                cursorColor = colors.accent,
            ),
        )
    }
}
