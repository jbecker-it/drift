@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.jbeckerit.drift.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.weight
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Send
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.jbeckerit.drift.AppContainer
import com.jbeckerit.drift.ai.Message
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun CoachScreen(container: AppContainer, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    val messages = remember { mutableStateListOf<Message>() }
    var input by remember { mutableStateOf("") }
    var working by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    Column(Modifier.fillMaxSize()) {
        TopAppBar(
            title = {
                Column {
                    Text("Coach")
                    Text("A quiet place to think out loud.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            },
            navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "Back") } },
        )
        if (messages.isEmpty()) {
            SectionCard(Modifier.padding(horizontal = DriftSpace.xLarge)) {
                Text("Start wherever you are", style = MaterialTheme.typography.titleLarge)
                Text("Try: “I can’t decide what to do first,” or “Help me unpack why today felt hard.”", modifier = Modifier.padding(top = DriftSpace.small), color = MaterialTheme.colorScheme.onSurfaceVariant)
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
                    label = { Text("Talk to Drift") },
                    modifier = Modifier.weight(1f),
                    enabled = !working,
                    maxLines = 4,
                )
                Button(
                    enabled = !working && input.isNotBlank(),
                    onClick = {
                        val prompt = input.trim()
                        input = ""
                        working = true
                        error = null
                        messages += Message("user", prompt)
                        messages += Message("assistant", "")
                        val answerIndex = messages.lastIndex
                        scope.launch {
                            runCatching {
                                container.ai.coach(messages.dropLast(2), prompt) { chunk ->
                                    withContext(Dispatchers.Main.immediate) {
                                        messages[answerIndex] = messages[answerIndex].copy(content = messages[answerIndex].content + chunk)
                                    }
                                }
                            }.onFailure {
                                messages.removeAt(answerIndex)
                                error = it.message ?: "Drift could not reach the AI service."
                            }
                            working = false
                        }
                    },
                ) { Icon(Icons.Rounded.Send, contentDescription = "Send") }
            }
        }
    }
}
