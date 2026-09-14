@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.jbeckerit.drift.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.weight
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.DeleteOutline
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
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
import com.jbeckerit.drift.ai.NanoAvailability
import com.jbeckerit.drift.data.Entry
import com.jbeckerit.drift.data.EntryTagData
import com.jbeckerit.drift.data.toTagData
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
    val nanoAvailability by container.nano.availability.collectAsStateWithLifecycle()
    val appSettings by container.settings.state.collectAsStateWithLifecycle()
    var ready by rememberSaveable(entryId) { mutableStateOf(false) }
    var actualId by rememberSaveable(entryId) { mutableStateOf("") }
    var body by rememberSaveable(entryId) { mutableStateOf("") }
    var mood by rememberSaveable(entryId) { mutableStateOf<Int?>(null) }
    var persistedBody by rememberSaveable(entryId) { mutableStateOf("") }
    var persistedMood by rememberSaveable(entryId) { mutableStateOf<Int?>(null) }
    var reflection by rememberSaveable(entryId) { mutableStateOf("") }
    var tagData by remember(entryId) { mutableStateOf<EntryTagData?>(null) }
    var status by rememberSaveable(entryId) { mutableStateOf("") }
    var error by rememberSaveable(entryId) { mutableStateOf<String?>(null) }
    var saving by rememberSaveable(entryId) { mutableStateOf(false) }
    var reflecting by rememberSaveable(entryId) { mutableStateOf(false) }
    var analyzing by rememberSaveable(entryId) { mutableStateOf(false) }
    var suggestions by remember(entryId) { mutableStateOf(emptyList<String>()) }
    var suggesting by rememberSaveable(entryId) { mutableStateOf(false) }
    var showSuggestions by rememberSaveable(entryId) { mutableStateOf(false) }
    var confirmDelete by rememberSaveable(entryId) { mutableStateOf(false) }
    var aiMenuOpen by rememberSaveable(entryId) { mutableStateOf(false) }

    LaunchedEffect(Unit) { container.nano.refresh() }

    LaunchedEffect(entryId) {
        val initial = if (entryId == null) repository.latestDraft() else repository.entry(entryId)
        actualId = initial?.id ?: UUID.randomUUID().toString()
        body = initial?.body.orEmpty()
        mood = initial?.mood
        persistedBody = body
        persistedMood = mood
        reflection = initial?.reflection.orEmpty()
        tagData = initial?.let { repository.entryTags(it.id)?.toTagData() }
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
                .onSuccess { saved ->
                    persistedBody = body
                    persistedMood = mood
                    if (appSettings.ai.automaticInsights && appSettings.ai.key.isNotBlank()) {
                        container.appScope.launch { runCatching { container.ai.analyzeEntry(saved) } }
                    }
                    onDone()
                }
                .onFailure { error = it.message ?: "Drift could not save that entry." }
            saving = false
        }
    }

    fun reflectWithCloud() {
        if (body.isBlank()) {
            error = "Write a little first, then Drift can reflect it back to you."
            return
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
    }

    fun reflectPrivately() {
        if (body.isBlank()) {
            error = "Write a little first, then Drift can reflect it back to you."
            return
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
                val answer = container.nano.reflect(saved.body)
                repository.storeReflection(saved.id, saved.revision, answer)
                answer
            }.onSuccess { answer ->
                persistedBody = textAtRequest
                persistedMood = moodAtRequest
                if (body == textAtRequest) reflection = answer
                status = "Offline reflection saved"
            }.onFailure { error = it.message ?: "Drift could not create an offline reflection." }
            reflecting = false
        }
    }

    fun findPatterns() {
        if (body.isBlank()) {
            error = "Write a little first, then Drift can find grounded patterns."
            return
        }
        val textAtRequest = body
        val moodAtRequest = mood
        val idAtRequest = actualId
        scope.launch {
            analyzing = true
            error = null
            runCatching {
                val saved = repository.saveEntry(idAtRequest, textAtRequest, moodAtRequest)
                saved to container.ai.analyzeEntry(saved)
            }.onSuccess { (_, insight) ->
                persistedBody = textAtRequest
                persistedMood = moodAtRequest
                tagData = insight
                status = if (insight.mentions.tasksOpen.isEmpty()) "Patterns saved" else "Patterns saved · clear unfinished tasks added"
            }.onFailure { error = it.message ?: "Drift could not find patterns in this entry." }
            analyzing = false
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
                if (entryId != null) {
                    IconButton(onClick = { confirmDelete = true }, enabled = ready && !saving && !reflecting && !analyzing) {
                        Icon(Icons.Rounded.DeleteOutline, contentDescription = "Delete journal entry")
                    }
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
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("How does it feel?", style = MaterialTheme.typography.labelLarge)
                    val words = body.trim().split(Regex("\\s+")).count(String::isNotBlank)
                    if (words > 0) Text("$words ${if (words == 1) "word" else "words"}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
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
            val hasCloudAi = appSettings.ai.key.isNotBlank()
            val hasPrivateAi = nanoAvailability is NanoAvailability.Ready
            Row(horizontalArrangement = Arrangement.spacedBy(DriftSpace.small), modifier = Modifier.fillMaxWidth()) {
                if (hasCloudAi || hasPrivateAi) {
                    OutlinedButton(
                        onClick = if (hasPrivateAi) ::reflectPrivately else ::reflectWithCloud,
                        enabled = ready && !saving && !reflecting && !analyzing,
                        modifier = Modifier.weight(1f),
                    ) {
                        if (reflecting) {
                            CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                            Text("Reflecting", modifier = Modifier.padding(start = DriftSpace.small))
                        } else {
                            Icon(Icons.Rounded.AutoAwesome, contentDescription = null)
                            Text(if (hasPrivateAi) "Reflect privately" else "Reflect", modifier = Modifier.padding(start = DriftSpace.small))
                        }
                    }
                }
                Button(
                    onClick = ::saveAndClose,
                    enabled = ready && !saving && !reflecting && !analyzing,
                    modifier = if (hasCloudAi || hasPrivateAi) Modifier.weight(1f) else Modifier.fillMaxWidth(),
                ) { Text(if (saving) "Saving…" else "Save entry") }
            }
            if (hasCloudAi) {
                Box {
                    TextButton(onClick = { aiMenuOpen = true }, enabled = ready && !saving && !reflecting && !analyzing) {
                        Text(if (analyzing) "Finding patterns…" else "AI options")
                    }
                    DropdownMenu(expanded = aiMenuOpen, onDismissRequest = { aiMenuOpen = false }) {
                        if (hasPrivateAi) {
                            DropdownMenuItem(
                                text = { Text("Reflect with cloud AI") },
                                onClick = { aiMenuOpen = false; reflectWithCloud() },
                            )
                        }
                        DropdownMenuItem(
                            text = { Text("Find patterns") },
                            onClick = { aiMenuOpen = false; findPatterns() },
                        )
                    }
                }
            }
            if (body.isBlank() && appSettings.ai.key.isNotBlank()) {
                TextButton(
                    onClick = {
                        scope.launch {
                            suggesting = true
                            showSuggestions = true
                            error = null
                            runCatching { container.ai.topicSuggestions() }
                                .onSuccess { result ->
                                    suggestions = result
                                    if (result.isEmpty()) error = "Write a couple of entries first, then Drift can offer a grounded starting point."
                                }
                                .onFailure { error = it.message ?: "Drift could not suggest a starting point." }
                            suggesting = false
                        }
                    },
                    enabled = ready && !suggesting && !reflecting && !analyzing,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    if (suggesting) CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                    Text(if (suggesting) "Finding a starting point" else "Need a starting point?", modifier = Modifier.padding(start = if (suggesting) DriftSpace.small else 0.dp))
                }
            }
            if (showSuggestions && suggestions.isNotEmpty()) {
                SectionCard {
                    Text("A few places you could begin", style = MaterialTheme.typography.titleMedium)
                    suggestions.forEach { suggestion ->
                        TextButton(
                            onClick = {
                                body = if (body.isBlank()) suggestion else "$body\n\n$suggestion"
                                showSuggestions = false
                            },
                            modifier = Modifier.fillMaxWidth(),
                        ) { Text(suggestion, modifier = Modifier.fillMaxWidth()) }
                    }
                }
            }
            ErrorText(error)
            tagData?.let { InsightCard(it) }
            if (reflection.isNotBlank() || reflecting) {
                SectionCard {
                    Text("A reflection", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    Text(if (reflection.isBlank()) "Thinking…" else reflection, modifier = Modifier.padding(top = DriftSpace.small))
                }
            }
        }
    }
    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("Delete this entry?") },
            text = { Text("This also removes its saved patterns and journal-linked tasks from this phone and future syncs.") },
            confirmButton = {
                Button(onClick = {
                    scope.launch {
                        ready = false
                        repository.deleteEntry(actualId)
                        onDone()
                    }
                }) { Text("Delete entry") }
            },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Keep it") } },
        )
    }
}

@Composable
private fun InsightCard(insight: EntryTagData) {
    SectionCard {
        Text("What Drift noticed", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        if (insight.oneLineSummary.isNotBlank()) {
            Text(insight.oneLineSummary, modifier = Modifier.padding(top = DriftSpace.small))
        }
        if (insight.topics.isNotEmpty()) {
            Text(insight.topics.joinToString(" · "), modifier = Modifier.padding(top = DriftSpace.small), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
        }
        if (insight.mentions.tasksOpen.isNotEmpty()) {
            Text("Added to To-dos: ${insight.mentions.tasksOpen.joinToString(", ")}", modifier = Modifier.padding(top = DriftSpace.small), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
