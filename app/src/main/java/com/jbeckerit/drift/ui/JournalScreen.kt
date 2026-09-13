package com.jbeckerit.drift.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
fun JournalScreen(container: AppContainer) {
    val repository = container.repository
    val scope = rememberCoroutineScope()
    val lifecycle = LocalLifecycleOwner.current
    val savedEntries by repository.observeEntries().collectAsStateWithLifecycle(initialValue = emptyList())
    var ready by rememberSaveable { mutableStateOf(false) }
    var entryId by rememberSaveable { mutableStateOf("") }
    var body by rememberSaveable { mutableStateOf("") }
    var mood by rememberSaveable { mutableStateOf<Int?>(null) }
    var persistedBody by rememberSaveable { mutableStateOf("") }
    var persistedMood by rememberSaveable { mutableStateOf<Int?>(null) }
    var reflection by rememberSaveable { mutableStateOf("") }
    var status by rememberSaveable { mutableStateOf("") }
    var error by rememberSaveable { mutableStateOf<String?>(null) }
    var reflecting by rememberSaveable { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        val draft = repository.latestDraft()
        entryId = draft?.id ?: UUID.randomUUID().toString()
        body = draft?.body.orEmpty()
        mood = draft?.mood
        persistedBody = body
        persistedMood = mood
        reflection = draft?.reflection.orEmpty()
        ready = true
    }

    LaunchedEffect(entryId, body, mood, persistedBody, persistedMood, ready) {
        if (ready && (body != persistedBody || mood != persistedMood)) {
            delay(450)
            repository.saveDraft(entryId, body, mood)
            persistedBody = body
            persistedMood = mood
            status = "Draft saved"
        }
    }

    val latestBody by rememberUpdatedState(body)
    val latestMood by rememberUpdatedState(mood)
    val latestPersistedBody by rememberUpdatedState(persistedBody)
    val latestPersistedMood by rememberUpdatedState(persistedMood)
    val latestId by rememberUpdatedState(entryId)
    val latestReady by rememberUpdatedState(ready)
    DisposableEffect(lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP && latestReady && (latestBody != latestPersistedBody || latestMood != latestPersistedMood)) {
                scope.launch { repository.saveDraft(latestId, latestBody, latestMood) }
            }
        }
        lifecycle.lifecycle.addObserver(observer)
        onDispose {
            lifecycle.lifecycle.removeObserver(observer)
            if (latestReady && (latestBody != latestPersistedBody || latestMood != latestPersistedMood)) {
                scope.launch { repository.saveDraft(latestId, latestBody, latestMood) }
            }
        }
    }

    fun flushCurrent() {
        val id = entryId
        val currentBody = body
        val currentMood = mood
        if (ready && (currentBody != persistedBody || currentMood != persistedMood)) {
            scope.launch { repository.saveDraft(id, currentBody, currentMood) }
        }
    }
    fun freshEntry() {
        flushCurrent()
        entryId = UUID.randomUUID().toString(); body = ""; mood = null; persistedBody = ""; persistedMood = null; reflection = ""; status = "New entry"; error = null
    }
    fun open(entry: Entry) {
        flushCurrent()
        entryId = entry.id; body = entry.body; mood = entry.mood; persistedBody = entry.body; persistedMood = entry.mood; reflection = entry.reflection.orEmpty(); status = "Editing saved entry"; error = null
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(start = 20.dp, end = 20.dp, bottom = 24.dp),
    ) {
        item {
            ScreenTitle("Journal", "Private, local-first, and always saveable.") {
                TextButton(onClick = ::freshEntry) { Text("New") }
            }
        }
        item {
            SectionCard {
                OutlinedTextField(
                    value = body,
                    onValueChange = { body = it; error = null },
                    modifier = Modifier.fillMaxWidth().heightIn(min = 180.dp),
                    label = { Text("What is on your mind?") },
                    minLines = 7,
                )
                Text("How does it feel?", modifier = Modifier.padding(top = 14.dp, bottom = 6.dp), style = MaterialTheme.typography.labelLarge)
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf("😞", "😕", "😐", "🙂", "😄").forEachIndexed { index, label ->
                        FilterChip(selected = mood == index + 1, onClick = { mood = if (mood == index + 1) null else index + 1 }, label = { Text(label) })
                    }
                }
                Row(modifier = Modifier.fillMaxWidth().padding(top = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        onClick = {
                            scope.launch {
                                runCatching { repository.saveEntry(entryId, body, mood) }
                                    .onSuccess { persistedBody = body; persistedMood = mood; status = "Saved locally"; error = null }
                                    .onFailure { error = it.message }
                            }
                        },
                        modifier = Modifier.weight(1f),
                    ) { Text("Save entry") }
                    TextButton(
                        onClick = {
                            scope.launch {
                                reflecting = true; error = null; reflection = ""
                                runCatching {
                                    val saved = repository.saveEntry(entryId, body, mood)
                                    container.ai.reflect(saved) { chunk -> withContext(Dispatchers.Main.immediate) { reflection += chunk } }
                                }.onSuccess { persistedBody = body; persistedMood = mood; status = "Saved with reflection" }.onFailure { error = it.message }
                                reflecting = false
                            }
                        },
                        enabled = !reflecting,
                    ) { Text(if (reflecting) "Reflecting…" else "Reflect") }
                }
                ErrorText(error)
                if (status.isNotBlank()) Text(status, modifier = Modifier.padding(top = 8.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.secondary)
            }
        }
        if (reflection.isNotBlank() || reflecting) item {
            SectionCard {
                Text("Reflection", style = MaterialTheme.typography.titleMedium)
                Text(if (reflection.isBlank()) "Thinking…" else reflection, modifier = Modifier.padding(top = 8.dp), style = MaterialTheme.typography.bodyMedium)
            }
        }
        item { Text("Recent entries", modifier = Modifier.padding(top = 8.dp), style = MaterialTheme.typography.titleMedium) }
        if (savedEntries.isEmpty()) item { EmptyState("Saved entries will appear here. Drafts remain in the editor until you save them.") }
        items(savedEntries, key = { it.id }) { entry ->
            SectionCard {
                SavedEntryRow(formatDate(entry.createdAt), entry.body.ifBlank { "Mood-only entry" }, onClick = { open(entry) })
            }
        }
    }
}
