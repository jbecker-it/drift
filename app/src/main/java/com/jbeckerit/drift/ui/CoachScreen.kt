@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.jbeckerit.drift.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Send
import androidx.compose.material3.Button
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.jbeckerit.drift.AppContainer
import com.jbeckerit.drift.ai.CoachModes
import com.jbeckerit.drift.ai.Message
import com.jbeckerit.drift.data.toStoredChatMessages
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun CoachScreen(container: AppContainer, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    val messages = remember { mutableStateListOf<Message>() }
    var sessionId by rememberSaveable { mutableStateOf("") }
    var mode by rememberSaveable { mutableStateOf(CoachModes.JUST_TALK) }
    var input by remember { mutableStateOf("") }
    var working by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(sessionId) {
        if (sessionId.isNotBlank() && messages.isEmpty()) {
            container.repository.chatSession(sessionId)?.let { session ->
                mode = CoachModes.normalize(session.promptType)
                session.messagesJson
                    .toStoredChatMessages()
                    .forEach { message -> messages += Message(message.role, message.content) }
            }
        }
    }

    fun endSession(after: () -> Unit = {}) {
        scope.launch {
            if (sessionId.isNotBlank()) container.repository.endChatSession(sessionId)
            sessionId = ""
            messages.clear()
            mode = CoachModes.JUST_TALK
            input = ""
            error = null
            after()
        }
    }

    BackHandler(onBack = { endSession(onBack) })

    Column(Modifier.fillMaxSize()) {
        TopAppBar(
            title = {
                Column {
                    Text("Coach")
                    Text(coachSubtitle(mode, messages.isNotEmpty()), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            },
            navigationIcon = { IconButton(onClick = { endSession(onBack) }) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "Back") } },
            actions = {
                if (messages.isNotEmpty()) TextButton(onClick = { endSession() }, enabled = !working) { Text("End") }
            },
        )
        if (messages.isEmpty()) {
            Column(
                modifier = Modifier.weight(1f).fillMaxWidth().padding(horizontal = DriftSpace.xLarge),
                verticalArrangement = Arrangement.spacedBy(DriftSpace.medium),
            ) {
                SectionCard {
                    Text("Start wherever you are", style = MaterialTheme.typography.titleLarge)
                    Text("Choose the amount of structure that would feel helpful right now.", modifier = Modifier.padding(top = DriftSpace.small), color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                CoachModesChooser(selected = mode, onSelect = { mode = it; error = null })
            }
        } else {
            androidx.compose.foundation.lazy.LazyColumn(
                modifier = Modifier.weight(1f).fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(DriftSpace.small),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = DriftSpace.xLarge, vertical = DriftSpace.medium),
            ) {
                items(messages.size) { index ->
                    val message = messages[index]
                    SectionCard(emphasized = message.role == "user") {
                        Text(if (message.role == "user") "You" else "Drift", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.secondary)
                        Text(message.content.ifBlank { "Thinking…" }, modifier = Modifier.padding(top = DriftSpace.xSmall), style = MaterialTheme.typography.bodyLarge)
                    }
                }
            }
        }
        Column(Modifier.padding(horizontal = DriftSpace.xLarge, vertical = DriftSpace.medium)) {
            ErrorText(error)
            Row(horizontalArrangement = Arrangement.spacedBy(DriftSpace.small), modifier = Modifier.fillMaxWidth()) {
                OutlinedTextField(
                    value = input,
                    onValueChange = { input = it; error = null },
                    label = { Text(coachInputLabel(mode)) },
                    placeholder = { Text(coachPlaceholder(mode)) },
                    modifier = Modifier.weight(1f),
                    enabled = !working,
                    maxLines = 4,
                )
                Button(
                    enabled = !working && input.isNotBlank(),
                    onClick = {
                        val prompt = input.trim()
                        if (container.settings.current().ai.key.isBlank()) {
                            error = "Set up Cloud AI in Settings before starting a coaching conversation."
                            return@Button
                        }
                        input = ""
                        working = true
                        error = null
                        val history = messages.toList()
                        scope.launch {
                            try {
                                val activeSession = if (sessionId.isBlank()) {
                                    container.repository.createChatSession(promptType = mode).also { sessionId = it.id }.id
                                } else {
                                    sessionId
                                }
                                check(container.repository.appendChatMessage(activeSession, "user", prompt)) { "Drift could not save this message." }
                                messages += Message("user", prompt)
                                messages += Message("assistant", "")
                                val answerIndex = messages.lastIndex
                                val answer = container.ai.coach(history, prompt, mode) { chunk ->
                                    withContext(Dispatchers.Main.immediate) {
                                        messages[answerIndex] = messages[answerIndex].copy(content = messages[answerIndex].content + chunk)
                                    }
                                }
                                container.repository.appendChatMessage(activeSession, "assistant", answer)
                            } catch (failure: Throwable) {
                                if (messages.lastOrNull()?.role == "assistant" && messages.last().content.isBlank()) messages.removeAt(messages.lastIndex)
                                error = failure.message ?: "Drift could not reach the AI service."
                            } finally {
                                working = false
                            }
                        }
                    },
                ) { Icon(Icons.Rounded.Send, contentDescription = "Send") }
            }
        }
    }
}

@Composable
private fun CoachModesChooser(selected: String, onSelect: (String) -> Unit) {
    val modes = listOf(
        CoachModeChoice(CoachModes.BRAIN_DUMP, "Brain dump", "Get it out without sorting it."),
        CoachModeChoice(CoachModes.MORNING, "Morning", "Choose one realistic intention."),
        CoachModeChoice(CoachModes.EVENING, "Wind down", "Set the day down gently."),
        CoachModeChoice(CoachModes.JUST_TALK, "Just talk", "Open conversation, no agenda."),
    )
    Column(verticalArrangement = Arrangement.spacedBy(DriftSpace.small)) {
        modes.chunked(2).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(DriftSpace.small), modifier = Modifier.fillMaxWidth()) {
                row.forEach { choice ->
                    if (choice.id == selected) {
                        Button(onClick = { onSelect(choice.id) }, modifier = Modifier.weight(1f)) {
                            Column {
                                Text(choice.label)
                                Text(choice.description, style = MaterialTheme.typography.labelSmall)
                            }
                        }
                    } else {
                        FilledTonalButton(onClick = { onSelect(choice.id) }, modifier = Modifier.weight(1f)) {
                            Column {
                                Text(choice.label)
                                Text(choice.description, style = MaterialTheme.typography.labelSmall)
                            }
                        }
                    }
                }
            }
        }
    }
}

private data class CoachModeChoice(val id: String, val label: String, val description: String)

private fun coachSubtitle(mode: String, hasMessages: Boolean): String = when {
    hasMessages -> when (CoachModes.normalize(mode)) {
        CoachModes.BRAIN_DUMP -> "Brain dump · no need to make it tidy."
        CoachModes.MORNING -> "Morning check-in · one thing is enough."
        CoachModes.EVENING -> "Wind down · closure before planning."
        else -> "A quiet place to think out loud."
    }
    else -> "Choose a gentle shape for this conversation."
}

private fun coachInputLabel(mode: String): String = when (CoachModes.normalize(mode)) {
    CoachModes.BRAIN_DUMP -> "What is taking up space?"
    CoachModes.MORNING -> "What is today asking of you?"
    CoachModes.EVENING -> "What would help you set today down?"
    else -> "Talk to Drift"
}

private fun coachPlaceholder(mode: String): String = when (CoachModes.normalize(mode)) {
    CoachModes.BRAIN_DUMP -> "No need to make this tidy."
    CoachModes.MORNING -> "Start with the next thing you can actually do."
    CoachModes.EVENING -> "You can keep this short."
    else -> "Start wherever you are."
}
