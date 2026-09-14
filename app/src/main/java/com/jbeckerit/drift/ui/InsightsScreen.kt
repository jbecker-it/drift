package com.jbeckerit.drift.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.ChatBubbleOutline
import androidx.compose.material.icons.rounded.Insights
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.jbeckerit.drift.AppContainer
import com.jbeckerit.drift.data.Entry
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

@Composable
fun ReflectScreen(container: AppContainer, onCoach: () -> Unit) {
    val entries by container.repository.observeEntries().collectAsStateWithLifecycle(initialValue = emptyList())
    val scope = rememberCoroutineScope()
    var summary by remember { mutableStateOf("") }
    var working by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val words = remember(entries) { entries.sumOf { it.body.trim().split(Regex("\\s+")).count(String::isNotBlank) } }
    val mood = remember(entries) { entries.mapNotNull { it.mood }.takeIf { it.isNotEmpty() }?.average() }
    val streak = remember(entries) { entryStreak(entries) }

    androidx.compose.foundation.lazy.LazyColumn(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(DriftSpace.medium),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(start = DriftSpace.xLarge, end = DriftSpace.xLarge, bottom = DriftSpace.xLarge),
    ) {
        item { ScreenTitle("Reflect", "Notice what is showing up, without needing to fix it.") }
        item {
            SectionCard(emphasized = true) {
                Icon(Icons.Rounded.ChatBubbleOutline, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                Text("Talk it through", modifier = Modifier.padding(top = DriftSpace.medium), style = MaterialTheme.typography.titleLarge)
                Text("A private conversation for sorting one thought at a time.", modifier = Modifier.padding(top = DriftSpace.xSmall), color = MaterialTheme.colorScheme.onPrimaryContainer)
                Button(onClick = onCoach, modifier = Modifier.fillMaxWidth().padding(top = DriftSpace.large)) { Text("Open coach") }
            }
        }
        item {
            SectionCard {
                Icon(Icons.Rounded.Insights, contentDescription = null, tint = MaterialTheme.colorScheme.tertiary)
                Text("Your writing rhythm", modifier = Modifier.padding(top = DriftSpace.medium), style = MaterialTheme.typography.titleLarge)
                Text(
                    if (entries.isEmpty()) "A pattern will emerge after you have a few entries." else "$words words across ${entries.size} ${if (entries.size == 1) "entry" else "entries"}.",
                    modifier = Modifier.padding(top = DriftSpace.xSmall),
                )
                if (entries.isNotEmpty()) {
                    Text("Current rhythm: $streak ${if (streak == 1) "day" else "days"}", modifier = Modifier.padding(top = DriftSpace.small), color = MaterialTheme.colorScheme.primary)
                    if (mood != null) Text("Average mood: ${"%.1f".format(mood)} / 5", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        item {
            SectionCard {
                Icon(Icons.Rounded.AutoAwesome, contentDescription = null, tint = MaterialTheme.colorScheme.secondary)
                Text("A weekly reflection", modifier = Modifier.padding(top = DriftSpace.medium), style = MaterialTheme.typography.titleLarge)
                Text("Ask only when it is useful. Recent saved entries are sent to the AI provider you configure.", modifier = Modifier.padding(top = DriftSpace.xSmall), color = MaterialTheme.colorScheme.onSurfaceVariant)
                Button(
                    onClick = {
                        scope.launch {
                            working = true
                            error = null
                            runCatching { container.ai.weeklySummary() }
                                .onSuccess { summary = it }
                                .onFailure { error = it.message ?: "Drift could not create a weekly reflection." }
                            working = false
                        }
                    },
                    enabled = !working,
                    modifier = Modifier.padding(top = DriftSpace.large),
                ) {
                    if (working) {
                        CircularProgressIndicator(modifier = Modifier.padding(end = DriftSpace.small), strokeWidth = 2.dp)
                        Text("Thinking")
                    } else {
                        Text(if (summary.isBlank()) "Create a reflection" else "Create another reflection")
                    }
                }
                ErrorText(error)
                if (summary.isNotBlank()) Text(summary, modifier = Modifier.padding(top = DriftSpace.large), style = MaterialTheme.typography.bodyLarge)
            }
        }
    }
}

private fun entryStreak(entries: List<Entry>): Int {
    if (entries.isEmpty()) return 0
    val zone = ZoneId.systemDefault()
    val dates = entries.map { Instant.ofEpochMilli(it.createdAt).atZone(zone).toLocalDate() }.toSet()
    var cursor = LocalDate.now(zone)
    if (cursor !in dates) cursor = cursor.minusDays(1)
    var streak = 0
    while (cursor in dates) {
        streak++
        cursor = cursor.minusDays(1)
    }
    return streak
}
