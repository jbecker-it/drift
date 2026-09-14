@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.jbeckerit.drift.ui

import android.Manifest
import android.net.Uri
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.Backup
import androidx.compose.material.icons.rounded.CloudSync
import androidx.compose.material.icons.rounded.Key
import androidx.compose.material.icons.rounded.Notifications
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.jbeckerit.drift.AppContainer
import com.jbeckerit.drift.backup.BackupInfo
import com.jbeckerit.drift.ai.NanoAvailability
import com.jbeckerit.drift.data.AiSettings
import com.jbeckerit.drift.data.ReminderSettings
import com.jbeckerit.drift.data.SyncSettings
import kotlinx.coroutines.launch
import java.time.LocalDate

@Composable
fun SettingsScreen(container: AppContainer, onBack: () -> Unit) {
    val state by container.settings.state.collectAsStateWithLifecycle()
    val nanoAvailability by container.nano.availability.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var key by remember { mutableStateOf("") }
    var model by remember { mutableStateOf("") }
    var personality by remember { mutableStateOf("coach") }
    var automaticInsights by remember { mutableStateOf(false) }
    var reminders by remember { mutableStateOf(false) }
    var morning by remember { mutableStateOf("08:00") }
    var evening by remember { mutableStateOf("20:00") }
    var taskTime by remember { mutableStateOf("18:00") }
    var syncEnabled by remember { mutableStateOf(false) }
    var syncUrl by remember { mutableStateOf("") }
    var syncUser by remember { mutableStateOf("") }
    var syncPassword by remember { mutableStateOf("") }
    var backupPassword by remember { mutableStateOf("") }
    var pendingRestoreUri by remember { mutableStateOf<Uri?>(null) }
    var pendingRestoreInfo by remember { mutableStateOf<BackupInfo?>(null) }
    var status by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var working by remember { mutableStateOf(false) }

    val notificationPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        status = if (granted) "Notifications are allowed." else "Android notification permission was not granted."
    }
    val createBackup = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
        if (uri != null) {
            scope.launch {
                val secret = backupPassword.toCharArray()
                working = true
                error = null
                status = "Creating encrypted backup…"
                runCatching { container.backup.create(uri, secret) }
                    .onSuccess { info ->
                        status = "Backup saved: ${info.entries} entries, ${info.tasks} tasks."
                        backupPassword = ""
                    }
                    .onFailure { error = it.message ?: "Drift could not create that backup." }
                secret.fill('\u0000')
                working = false
            }
        }
    }
    val openBackup = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) {
            scope.launch {
                val secret = backupPassword.toCharArray()
                working = true
                error = null
                status = "Checking backup…"
                runCatching { container.backup.inspect(uri, secret) }
                    .onSuccess { info ->
                        pendingRestoreUri = uri
                        pendingRestoreInfo = info
                        status = ""
                    }
                    .onFailure { error = it.message ?: "Drift could not read that backup." }
                secret.fill('\u0000')
                working = false
            }
        }
    }

    LaunchedEffect(Unit) { container.nano.refresh() }

    LaunchedEffect(state) {
        key = state.ai.key
        model = state.ai.model
        personality = state.ai.personality
        automaticInsights = state.ai.automaticInsights
        reminders = state.reminders.enabled
        morning = state.reminders.morning
        evening = state.reminders.evening
        taskTime = state.reminders.taskTime
        syncEnabled = state.sync.enabled
        syncUrl = state.sync.url
        syncUser = state.sync.username
        syncPassword = state.sync.password
    }

    Column(Modifier.fillMaxSize()) {
        TopAppBar(
            title = {
                Column {
                    Text("Settings")
                    Text("Private controls, kept out of your way.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            },
            navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "Back") } },
        )
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.spacedBy(DriftSpace.medium),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(start = DriftSpace.xLarge, end = DriftSpace.xLarge, bottom = DriftSpace.xLarge),
        ) {
            item {
                SectionCard {
                    SettingHeading(Icons.Rounded.Backup, "Backups", "An encrypted copy you can restore on another phone.")
                    state.backup.lastSuccessAt?.let { lastBackupAt ->
                        Text(
                            "Last backup: ${formatDate(lastBackupAt)} · ${state.backup.entries} entries, ${state.backup.tasks} tasks",
                            modifier = Modifier.padding(top = DriftSpace.medium),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.primary,
                        )
                    }
                    OutlinedTextField(
                        value = backupPassword,
                        onValueChange = { backupPassword = it; error = null },
                        label = { Text("Backup password") },
                        supportingText = { Text("Use at least 10 characters. Drift cannot recover it for you.") },
                        modifier = Modifier.fillMaxWidth().padding(top = DriftSpace.medium),
                        visualTransformation = PasswordVisualTransformation(),
                        singleLine = true,
                    )
                    Row(modifier = Modifier.fillMaxWidth().padding(top = DriftSpace.small), horizontalArrangement = Arrangement.spacedBy(DriftSpace.small)) {
                        Button(
                            onClick = {
                                if (backupPassword.length < 10) error = "Use a backup password with at least 10 characters."
                                else createBackup.launch("drift-backup-${LocalDate.now()}.drift")
                            },
                            enabled = !working,
                            modifier = Modifier.weight(1f),
                        ) { Text("Back up now") }
                        OutlinedButton(
                            onClick = {
                                if (backupPassword.length < 10) error = "Enter the backup password first."
                                else openBackup.launch(arrayOf("application/octet-stream", "application/x-drift-backup"))
                            },
                            enabled = !working,
                            modifier = Modifier.weight(1f),
                        ) { Text("Restore") }
                    }
                    Text("Backups never include your AI key or WebDAV password.", modifier = Modifier.padding(top = DriftSpace.medium), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            item {
                SectionCard {
                    SettingHeading(Icons.Rounded.Key, "Cloud AI", "Optional. Your journal stays usable without it.")
                    OutlinedTextField(value = key, onValueChange = { key = it }, label = { Text("OpenRouter API key") }, modifier = Modifier.fillMaxWidth().padding(top = DriftSpace.medium), visualTransformation = PasswordVisualTransformation(), singleLine = true)
                    OutlinedTextField(value = model, onValueChange = { model = it }, label = { Text("Model") }, modifier = Modifier.fillMaxWidth().padding(top = DriftSpace.small), singleLine = true)
                    Text("Style", modifier = Modifier.padding(top = DriftSpace.medium), style = MaterialTheme.typography.labelLarge)
                    Row(horizontalArrangement = Arrangement.spacedBy(DriftSpace.small), modifier = Modifier.padding(top = DriftSpace.small)) {
                        listOf("coach", "listener", "challenger").forEach { option ->
                            FilterChip(selected = personality == option, onClick = { personality = option }, label = { Text(option.replaceFirstChar { it.uppercase() }) })
                        }
                    }
                    Row(modifier = Modifier.fillMaxWidth().padding(top = DriftSpace.medium), horizontalArrangement = Arrangement.SpaceBetween) {
                        Column(Modifier.weight(1f)) {
                            Text("Find patterns after saving")
                            Text("Sends each new saved entry to your configured provider, then refreshes a small context after the first insight and every five after that.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Switch(checked = automaticInsights, onCheckedChange = { automaticInsights = it })
                    }
                    Button(
                        onClick = {
                            container.settings.saveAi(AiSettings(key.trim(), model.trim().ifBlank { "openai/gpt-4o-mini" }, personality, automaticInsights))
                            status = "Cloud AI settings saved."
                        },
                        modifier = Modifier.padding(top = DriftSpace.medium),
                    ) { Text("Save AI settings") }
                }
            }
            item {
                SectionCard {
                    SettingHeading(Icons.Rounded.AutoAwesome, "On-device assistance", "Use Gemini Nano locally when your phone supports it.")
                    when (val availability = nanoAvailability) {
                        NanoAvailability.Checking -> Text("Checking this phone…", modifier = Modifier.padding(top = DriftSpace.medium), color = MaterialTheme.colorScheme.onSurfaceVariant)
                        NanoAvailability.Downloadable -> {
                            Text("Gemini Nano can be downloaded for private, offline reflections.", modifier = Modifier.padding(top = DriftSpace.medium), color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Button(onClick = { scope.launch { container.nano.download() } }, modifier = Modifier.padding(top = DriftSpace.medium)) { Text("Download Gemini Nano") }
                        }
                        NanoAvailability.Downloading -> {
                            Row(modifier = Modifier.padding(top = DriftSpace.medium), horizontalArrangement = Arrangement.spacedBy(DriftSpace.small)) {
                                CircularProgressIndicator()
                                Text("Downloading Gemini Nano…")
                            }
                        }
                        is NanoAvailability.Ready -> {
                            Text(
                                if (availability.modelName.isNullOrBlank()) "Gemini Nano is ready for private, offline reflections." else "${availability.modelName} is ready for private, offline reflections.",
                                modifier = Modifier.padding(top = DriftSpace.medium),
                                color = MaterialTheme.colorScheme.primary,
                            )
                            OutlinedButton(onClick = { scope.launch { container.nano.refresh() } }, modifier = Modifier.padding(top = DriftSpace.medium)) { Text("Check again") }
                        }
                        is NanoAvailability.Unavailable -> {
                            Text(availability.message, modifier = Modifier.padding(top = DriftSpace.medium), color = MaterialTheme.colorScheme.onSurfaceVariant)
                            OutlinedButton(onClick = { scope.launch { container.nano.refresh() } }, modifier = Modifier.padding(top = DriftSpace.medium)) { Text("Check again") }
                        }
                    }
                    Text("Drift checks the AICore service on your phone. No journal text leaves the phone for this feature.", modifier = Modifier.padding(top = DriftSpace.medium), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            item {
                SectionCard {
                    SettingHeading(Icons.Rounded.Notifications, "Reminders", "Ask gently, only at times you choose.")
                    Row(modifier = Modifier.fillMaxWidth().padding(top = DriftSpace.small), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("Use Android reminders")
                        Switch(checked = reminders, onCheckedChange = { reminders = it })
                    }
                    OutlinedTextField(value = morning, onValueChange = { morning = it }, label = { Text("Morning (HH:MM)") }, modifier = Modifier.fillMaxWidth().padding(top = DriftSpace.small), singleLine = true)
                    OutlinedTextField(value = evening, onValueChange = { evening = it }, label = { Text("Evening (HH:MM)") }, modifier = Modifier.fillMaxWidth().padding(top = DriftSpace.small), singleLine = true)
                    OutlinedTextField(value = taskTime, onValueChange = { taskTime = it }, label = { Text("Tasks (HH:MM)") }, modifier = Modifier.fillMaxWidth().padding(top = DriftSpace.small), singleLine = true)
                    Row(horizontalArrangement = Arrangement.spacedBy(DriftSpace.small), modifier = Modifier.padding(top = DriftSpace.medium)) {
                        Button(onClick = {
                            val value = ReminderSettings(reminders, morning, evening, taskTime)
                            container.settings.saveReminders(value)
                            container.reminders.scheduleAll(value)
                            status = "Reminder schedule saved."
                        }) { Text("Save reminders") }
                        if (Build.VERSION.SDK_INT >= 33) {
                            OutlinedButton(onClick = { notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS) }) { Text("Allow") }
                        }
                    }
                }
            }
            item {
                SectionCard {
                    SettingHeading(Icons.Rounded.CloudSync, "WebDAV sync", "Optional device-to-device sync through a server you control.")
                    Row(modifier = Modifier.fillMaxWidth().padding(top = DriftSpace.small), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("Enable sync")
                        Switch(checked = syncEnabled, onCheckedChange = { syncEnabled = it })
                    }
                    OutlinedTextField(value = syncUrl, onValueChange = { syncUrl = it }, label = { Text("WebDAV folder or .json URL") }, modifier = Modifier.fillMaxWidth().padding(top = DriftSpace.small), singleLine = true)
                    OutlinedTextField(value = syncUser, onValueChange = { syncUser = it }, label = { Text("Username") }, modifier = Modifier.fillMaxWidth().padding(top = DriftSpace.small), singleLine = true)
                    OutlinedTextField(value = syncPassword, onValueChange = { syncPassword = it }, label = { Text("Password or app password") }, modifier = Modifier.fillMaxWidth().padding(top = DriftSpace.small), visualTransformation = PasswordVisualTransformation(), singleLine = true)
                    Row(horizontalArrangement = Arrangement.spacedBy(DriftSpace.small), modifier = Modifier.padding(top = DriftSpace.medium)) {
                        Button(onClick = {
                            val value = SyncSettings(syncEnabled, syncUrl.trim(), syncUser.trim(), syncPassword)
                            container.settings.saveSync(value)
                            if (value.enabled) container.work.syncSoon()
                            status = "Sync settings saved."
                        }) { Text("Save sync") }
                        OutlinedButton(enabled = syncEnabled && !working, onClick = {
                            scope.launch {
                                error = null
                                status = "Syncing…"
                                working = true
                                runCatching { container.webDav.sync(SyncSettings(true, syncUrl.trim(), syncUser.trim(), syncPassword)) }
                                    .onSuccess { status = "Synced ${it.entries} entries and ${it.tasks} tasks." }
                                    .onFailure { error = it.message ?: "Drift could not sync." }
                                working = false
                            }
                        }) { Text("Sync now") }
                    }
                }
            }
            item {
                SectionCard {
                    Text("Privacy", style = MaterialTheme.typography.titleMedium)
                    Text("Journal entries and tasks remain on this phone unless you choose a backup, WebDAV sync, or an AI feature. Drift has no account, tracking, or hidden network calls.", modifier = Modifier.padding(top = DriftSpace.xSmall), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (working) Row(modifier = Modifier.padding(top = DriftSpace.medium), horizontalArrangement = Arrangement.spacedBy(DriftSpace.small)) {
                        CircularProgressIndicator()
                        Text(status.ifBlank { "Working…" })
                    }
                    ErrorText(error)
                    if (status.isNotBlank() && !working) Text(status, modifier = Modifier.padding(top = DriftSpace.small), color = MaterialTheme.colorScheme.secondary)
                }
            }
        }
    }

    val restoreUri = pendingRestoreUri
    val restoreInfo = pendingRestoreInfo
    if (restoreUri != null && restoreInfo != null) {
        RestoreBackupDialog(
            info = restoreInfo,
            onDismiss = { pendingRestoreUri = null; pendingRestoreInfo = null },
            onRestore = {
                scope.launch {
                    val secret = backupPassword.toCharArray()
                    working = true
                    error = null
                    status = "Restoring backup…"
                    runCatching { container.backup.restore(restoreUri, secret) }
                        .onSuccess { info ->
                            container.reminders.scheduleAll(container.settings.current().reminders)
                            backupPassword = ""
                            status = "Restored ${info.entries} entries and ${info.tasks} tasks."
                        }
                        .onFailure { error = it.message ?: "Drift could not restore that backup." }
                    secret.fill('\u0000')
                    pendingRestoreUri = null
                    pendingRestoreInfo = null
                    working = false
                }
            },
        )
    }
}

@Composable
private fun SettingHeading(icon: androidx.compose.ui.graphics.vector.ImageVector, title: String, description: String) {
    Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
        Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
        Column(Modifier.padding(start = DriftSpace.medium)) {
            Text(title, style = MaterialTheme.typography.titleMedium)
            Text(description, modifier = Modifier.padding(top = DriftSpace.xSmall), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun RestoreBackupDialog(info: BackupInfo, onDismiss: () -> Unit, onRestore: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Replace current data?") },
        text = {
            Text("This backup contains ${info.entries} entries, ${info.tasks} tasks, and ${info.routines} routines. Drift validates the archive before replacing data. Your current AI key and WebDAV password will be cleared.")
        },
        confirmButton = { Button(onClick = onRestore) { Text("Restore backup") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
