package com.jbeckerit.drift.ui

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.jbeckerit.drift.AppContainer
import com.jbeckerit.drift.data.AiSettings
import com.jbeckerit.drift.data.ReminderSettings
import com.jbeckerit.drift.data.SyncSettings
import kotlinx.coroutines.launch

@Composable
fun SettingsScreen(container: AppContainer) {
    val state by container.settings.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var key by remember { mutableStateOf("") }
    var model by remember { mutableStateOf("") }
    var personality by remember { mutableStateOf("coach") }
    var reminders by remember { mutableStateOf(false) }
    var morning by remember { mutableStateOf("08:00") }
    var evening by remember { mutableStateOf("20:00") }
    var taskTime by remember { mutableStateOf("18:00") }
    var syncEnabled by remember { mutableStateOf(false) }
    var syncUrl by remember { mutableStateOf("") }
    var syncUser by remember { mutableStateOf("") }
    var syncPassword by remember { mutableStateOf("") }
    var status by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    val notificationPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        status = if (granted) "Notifications enabled" else "Android notification permission was not granted"
    }

    LaunchedEffect(state) {
        key = state.ai.key; model = state.ai.model; personality = state.ai.personality
        reminders = state.reminders.enabled; morning = state.reminders.morning; evening = state.reminders.evening; taskTime = state.reminders.taskTime
        syncEnabled = state.sync.enabled; syncUrl = state.sync.url; syncUser = state.sync.username; syncPassword = state.sync.password
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(start = 20.dp, end = 20.dp, bottom = 24.dp),
    ) {
        item { ScreenTitle("Settings", "Sensitive credentials are encrypted with Android Keystore on this device.") }
        item {
            SectionCard {
                Text("AI", style = MaterialTheme.typography.titleMedium)
                Text("AI is optional. Saving, drafts, tasks, reminders, and sync do not depend on it.", modifier = Modifier.padding(top = 6.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                OutlinedTextField(value = key, onValueChange = { key = it }, label = { Text("OpenRouter API key") }, modifier = Modifier.fillMaxWidth().padding(top = 12.dp), visualTransformation = PasswordVisualTransformation(), singleLine = true)
                OutlinedTextField(value = model, onValueChange = { model = it }, label = { Text("Model") }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp), singleLine = true)
                Text("Style", modifier = Modifier.padding(top = 10.dp), style = MaterialTheme.typography.labelLarge)
                androidx.compose.foundation.layout.Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf("coach", "listener", "challenger").forEach { option ->
                        FilterChip(selected = personality == option, onClick = { personality = option }, label = { Text(option.replaceFirstChar { it.uppercase() }) })
                    }
                }
                Button(onClick = { container.settings.saveAi(AiSettings(key.trim(), model.trim().ifBlank { "openai/gpt-4o-mini" }, personality)); status = "AI settings saved" }, modifier = Modifier.padding(top = 12.dp)) { Text("Save AI settings") }
            }
        }
        item {
            SectionCard {
                Text("Reminders", style = MaterialTheme.typography.titleMedium)
                androidx.compose.foundation.layout.Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("Use Android reminders", modifier = Modifier.padding(top = 10.dp))
                    Switch(checked = reminders, onCheckedChange = { reminders = it })
                }
                OutlinedTextField(value = morning, onValueChange = { morning = it }, label = { Text("Morning (HH:MM)") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                OutlinedTextField(value = evening, onValueChange = { evening = it }, label = { Text("Evening (HH:MM)") }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp), singleLine = true)
                OutlinedTextField(value = taskTime, onValueChange = { taskTime = it }, label = { Text("Tasks (HH:MM)") }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp), singleLine = true)
                Button(onClick = {
                    val value = ReminderSettings(reminders, morning, evening, taskTime)
                    container.settings.saveReminders(value); container.reminders.scheduleAll(value); status = "Reminder schedule saved"
                }, modifier = Modifier.padding(top = 12.dp)) { Text("Save reminders") }
                if (Build.VERSION.SDK_INT >= 33) Button(onClick = { notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS) }, modifier = Modifier.padding(start = 8.dp, top = 12.dp)) { Text("Allow notifications") }
            }
        }
        item {
            SectionCard {
                Text("WebDAV sync", style = MaterialTheme.typography.titleMedium)
                Text("Optional. Drift writes one drift-v2.json file. The server is your storage provider; use HTTPS and a private folder.", modifier = Modifier.padding(top = 6.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                androidx.compose.foundation.layout.Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("Enable sync", modifier = Modifier.padding(top = 10.dp))
                    Switch(checked = syncEnabled, onCheckedChange = { syncEnabled = it })
                }
                OutlinedTextField(value = syncUrl, onValueChange = { syncUrl = it }, label = { Text("WebDAV folder or .json URL") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                OutlinedTextField(value = syncUser, onValueChange = { syncUser = it }, label = { Text("Username") }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp), singleLine = true)
                OutlinedTextField(value = syncPassword, onValueChange = { syncPassword = it }, label = { Text("Password or app password") }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp), visualTransformation = PasswordVisualTransformation(), singleLine = true)
                androidx.compose.foundation.layout.Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 12.dp)) {
                    Button(onClick = {
                        val value = SyncSettings(syncEnabled, syncUrl.trim(), syncUser.trim(), syncPassword)
                        container.settings.saveSync(value)
                        if (value.enabled) container.work.syncSoon()
                        status = "Sync settings saved"
                    }) { Text("Save sync") }
                    Button(enabled = syncEnabled, onClick = {
                        scope.launch {
                            error = null; status = "Syncing…"
                            runCatching { container.webDav.sync(SyncSettings(true, syncUrl.trim(), syncUser.trim(), syncPassword)) }
                                .onSuccess { status = "Synced ${it.entries} entries and ${it.tasks} tasks" }
                                .onFailure { error = it.message }
                        }
                    }) { Text("Sync now") }
                }
            }
        }
        item {
            SectionCard {
                Text("Privacy", style = MaterialTheme.typography.titleMedium)
                Text("Journal and task data live in Room on this device. The app has no account, analytics, or hidden network calls. AI text only leaves the device when you request an AI feature; WebDAV only runs when you turn it on.", modifier = Modifier.padding(top = 6.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                ErrorText(error)
                if (status.isNotBlank()) Text(status, modifier = Modifier.padding(top = 8.dp), color = MaterialTheme.colorScheme.secondary)
            }
        }
    }
}
