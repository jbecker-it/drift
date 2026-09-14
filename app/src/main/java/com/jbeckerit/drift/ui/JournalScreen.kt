@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.jbeckerit.drift.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.weight
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.jbeckerit.drift.AppContainer
import com.jbeckerit.drift.data.Entry
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.UUID

@Composable
fun JournalScreen(
    container: AppContainer,
    onNew: () -> Unit,
    onOpen: (String) -> Unit,
) {
    val entries by container.repository.observeEntries().collectAsStateWithLifecycle(initialValue = emptyList())

    androidx.compose.foundation.lazy.LazyColumn(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(DriftSpace.medium),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(start = DriftSpace.xLarge, end = DriftSpace.xLarge, bottom = DriftSpace.xLarge),
    ) {
        item {
            ScreenTitle("Journal", "Your words have a quiet place to land.") {
                FilledTonalButton(onClick = onNew) {
                    Icon(Icons.Rounded.Edit, contentDescription = null)
                    Text("Write", modifier = Modifier.padding(start = DriftSpace.small))
                }
            }
        }
        item {
            SectionCard(emphasized = true) {
                Text("How are you arriving?", style = MaterialTheme.typography.titleLarge)
                Text("There is no right length. One sentence counts.", modifier = Modifier.padding(top = DriftSpace.xSmall), color = MaterialTheme.colorScheme.onPrimaryContainer)
                Button(onClick = onNew, modifier = Modifier.fillMaxWidth().padding(top = DriftSpace.large)) { Text("Start writing") }
            }
        }
        item {
            Text("Recent entries", modifier = Modifier.padding(top = DriftSpace.small), style = MaterialTheme.typography.titleLarge)
        }
        if (entries.isEmpty()) {
            item { EmptyState("Your saved entries will appear here. Drafts stay with you until you decide they are ready.") }
        } else {
            items(entries, key = { it.id }) { entry ->
                SavedEntryRow(formatDate(entry.createdAt), entry.body) { onOpen(entry.id) }
            }
        }
    }
}

@Composable
fun JournalEditorScreen(container: AppContainer, entryId: String?, onDone: () -> Unit) {
    val repository = container.repository
    val scope = rememberCoroutineScope()
    val lifecycle = LocalLifecycleOwner.current
    var ready by rememberSaveable(entryId) { mutableStateOf(false) }
    var actualId by rememberSaveable(entryId) { mutableStateOf("") }
    var body by rememberSaveable(entryId) { mutableStateOf("") }
    var mood by rememberSaveable(entryId) { mutableStateOf<Int?>(null) }
    var persistedBody by rememberSaveable(entryId) { mutableStateOf("") }
    var persistedMood by rememberSaveable(entryId) { mutableStateOf<Int?>(null) }
    var reflection by rememberSaveable(entryId) { mutableStateOf("") }
    var status by rememberSaveable(entryId) { mutableStateOf("") }
    var error by rememberSaveable(entryId) { mutableStateOf<String?>(null) }
    var saving by rememberSaveable(entryId) { mutableStateOf(false) }
    var reflecting by rememberSaveable(entryId) { mutableStateOf(false) }

    LaunchedEffect(entryId) {
        val initial = if (entryId == null) repository.latestDraft() else repository.entry(entryId)
        actualId = initial?.id ?: UUID.randomUUID().toString()
        body = initial?.body.orEmpty()
        mood = initial?.mood
        persistedBody = body
        persistedMood = mood
        reflection = initial?.reflection.orEmpty()
        ready = true
    }

    LaunchedEffect(actualId, body, mood, persistedBody, persistedMood, ready) {
        if (ready && (body != persistedBody || mood != persistedMood)) {
            delay(450)
            repository.saveDraft(actualId, body, mood)
            persistedBody = body
            persistedMood = mood
            status = "Draft saved"
        }
    }

    val latestBody by rememberUpdatedState(body)
    val latestMood by rememberUpdatedState(mood)
    val latestPersistedBody by rememberUpdatedState(persistedBody)
    val latestPersistedMood by rememberUpdatedState(persistedMood)
    val latestId by rememberUpdatedState(actualId)
    val latestReady by rememberUpdatedState(ready)
    DisposableEffect(lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP && latestReady && (latestBody != latestPersistedBody || latestMood != latestPersistedMood)) {
                scope.launch { repository.saveDraft(latestId, latestBody, latestMood) }
            }
        }
        lifecycle.lifecycle.addObserver(observer)
        onDispose { lifecycle.lifecycle.removeObserver(observer) }
    }

    fun closeEditor() {
        scope.launch {
            if (ready && (body != persistedBody || mood != persistedMood)) {
                repository.saveDraft(actualId, body, mood)
            }
            onDone()
        }
    }

    fun saveAndClose() {
        if (body.isBlank()) {
            error = "A few words are enough before you save."
            return
        }
        scope.launch {
            saving = true
            runCatching { repository.saveEntry(actualId, body, mood) }
                .onSuccess {
                    persistedBody = body
                    persistedMood = mood
                    onDone()
                }
                .onFailure { error = it.message ?: "Drift could not save that entry." }
            saving = false
        }
    }

    BackHandler(onBack = ::closeEditor)
    Column(Modifier.fillMaxSize().imePadding()) {
        TopAppBar(
            title = {
                Column {
                    Text(if (entryId == null) "New entry" else "Edit entry")
                    Text(if (status.isBlank()) "Saved on this phone" else status, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            },
            navigationIcon = {
                IconButton(onClick = ::closeEditor) {
                    Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "Close journal entry")
                }
            },
            actions = {
                TextButton(onClick = ::saveAndClose, enabled = ready && !saving) {
                    if (saving) {
                        CircularProgressIndicator(modifier = Modifier.padding(end = DriftSpace.xSmall), strokeWidth = 2.dp)
                    } else {
                        Icon(Icons.Rounded.Check, contentDescription = null)
                    }
                    Text("Done", modifier = Modifier.padding(start = DriftSpace.xSmall))
                }
            },
        )
        Column(
            modifier = Modifier.fillMaxSize().padding(horizontal = DriftSpace.xLarge, vertical = DriftSpace.medium),
            verticalArrangement = Arrangement.spacedBy(DriftSpace.medium),
        ) {
            OutlinedTextField(
                value = body,
                onValueChange = { body = it; error = null },
                modifier = Modifier.fillMaxWidth().weight(1f).heightIn(min = 240.dp),
                placeholder = { Text("What is on your mind?") },
                textStyle = MaterialTheme.typography.bodyLarge,
                minLines = 8,
                enabled = ready,
            )
            Column {
                Text("How does it feel?", style = MaterialTheme.typography.labelLarge)
                Row(horizontalArrangement = Arrangement.spacedBy(DriftSpace.small), modifier = Modifier.padding(top = DriftSpace.small)) {
                    listOf("😞", "😕", "😐", "🙂", "😄").forEachIndexed { index, label ->
                        FilterChip(
                            selected = mood == index + 1,
                            onClick = { mood = if (mood == index + 1) null else index + 1 },
                            label = { Text(label) },
                        )
                    }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(DriftSpace.small), modifier = Modifier.fillMaxWidth()) {
                OutlinedButton(
                    onClick = {
                        if (body.isBlank()) {
                            error = "Write a little first, then Drift can reflect it back to you."
                            return@OutlinedButton
                        }
                        val textAtRequest = body
                        val moodAtRequest = mood
                        val idAtRequest = actualId
                        scope.launch {
                            reflecting = true
                            error = null
                            reflection = ""
                            runCatching {
                                val saved = repository.saveEntry(idAtRequest, textAtRequest, moodAtRequest)
                                container.ai.reflect(saved) { chunk ->
                                    withContext(Dispatchers.Main.immediate) {
                                        if (body == textAtRequest) reflection += chunk
                                    }
                                }
                            }.onSuccess {
                                persistedBody = textAtRequest
                                persistedMood = moodAtRequest
                                status = "Reflection saved"
                            }.onFailure { error = it.message ?: "Drift could not create a reflection." }
                            reflecting = false
                        }
                    },
                    enabled = ready && !reflecting,
                    modifier = Modifier.weight(1f),
                ) {
                    if (reflecting) {
                        CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                        Text("Reflecting", modifier = Modifier.padding(start = DriftSpace.small))
                    } else {
                        Icon(Icons.Rounded.AutoAwesome, contentDescription = null)
                        Text("Reflect", modifier = Modifier.padding(start = DriftSpace.small))
                    }
                }
                Button(onClick = ::saveAndClose, enabled = ready && !saving, modifier = Modifier.weight(1f)) { Text("Save entry") }
            }
            ErrorText(error)
            if (reflection.isNotBlank() || reflecting) {
                SectionCard {
                    Text("A reflection", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    Text(if (reflection.isBlank()) "Thinking…" else reflection, modifier = Modifier.padding(top = DriftSpace.small))
                }
            }
        }
    }
}
