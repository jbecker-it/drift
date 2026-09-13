package com.jbeckerit.drift.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
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
fun CoachScreen(container: AppContainer) {
    val scope = rememberCoroutineScope()
    val messages = remember { mutableStateListOf<Message>() }
    var input by remember { mutableStateOf("") }
    var working by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    Column(Modifier.fillMaxSize()) {
        ScreenTitle("Coach", "A private conversation. Your journal is only shared when you ask Drift to use it.")
        if (messages.isEmpty()) {
            SectionCard(Modifier.padding(horizontal = 20.dp)) {
                Text("Start wherever you are", style = MaterialTheme.typography.titleMedium)
                Text("Try: “I can’t decide what to do first,” or “Help me unpack why today felt hard.”", modifier = Modifier.padding(top = 6.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        } else {
            LazyColumn(
                modifier = Modifier.weight(1f).fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(8.dp),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 20.dp, vertical = 8.dp),
            ) {
                itemsIndexed(messages) { _, message ->
                    SectionCard {
                        Text(if (message.role == "user") "You" else "Drift", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.secondary)
                        Text(message.content.ifBlank { "Thinking…" }, modifier = Modifier.padding(top = 4.dp))
                    }
                }
            }
        }
        Column(Modifier.padding(horizontal = 20.dp, vertical = 12.dp)) {
            ErrorText(error)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
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
                        val prompt = input.trim(); input = ""; working = true; error = null
                        messages += Message("user", prompt)
                        messages += Message("assistant", "")
                        val answerIndex = messages.lastIndex
                        scope.launch {
                            runCatching {
                                container.ai.coach(messages.dropLast(2), prompt) { chunk ->
                                    withContext(Dispatchers.Main.immediate) { messages[answerIndex] = messages[answerIndex].copy(content = messages[answerIndex].content + chunk) }
                                }
                            }.onFailure {
                                messages.removeAt(answerIndex)
                                error = it.message ?: "Drift could not reach the AI service."
                            }
                            working = false
                        }
                    },
                ) { Text(if (working) "…" else "Send") }
            }
        }
    }
}
