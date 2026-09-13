package com.jbeckerit.drift.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
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
fun InsightsScreen(container: AppContainer) {
    val entries by container.repository.observeEntries().collectAsStateWithLifecycle(initialValue = emptyList())
    val scope = rememberCoroutineScope()
    var summary by remember { mutableStateOf("") }
    var working by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val words = remember(entries) { entries.sumOf { it.body.trim().split(Regex("\\s+")).count { word -> word.isNotBlank() } } }
    val mood = remember(entries) { entries.mapNotNull { it.mood }.takeIf { it.isNotEmpty() }?.average() }
    val streak = remember(entries) { entryStreak(entries) }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(start = 20.dp, end = 20.dp, bottom = 24.dp),
    ) {
        item { ScreenTitle("Insights", "Patterns are shown from what you have actually saved.") }
        item {
            SectionCard {
                Text("Writing rhythm", style = MaterialTheme.typography.titleMedium)
                Text("${entries.size} saved ${if (entries.size == 1) "entry" else "entries"} · $words words", modifier = Modifier.padding(top = 8.dp))
                Text("Current streak: $streak ${if (streak == 1) "day" else "days"}", color = MaterialTheme.colorScheme.secondary)
                if (mood != null) Text("Average mood: ${"%.1f".format(mood)} / 5", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        item {
            SectionCard {
                Text("Weekly reflection", style = MaterialTheme.typography.titleMedium)
                Text("This is generated only when you request it. Your recent saved entries are sent to the AI provider you configure.", modifier = Modifier.padding(top = 6.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                Button(
                    onClick = {
                        scope.launch {
                            working = true; error = null
                            runCatching { container.ai.weeklySummary() }.onSuccess { summary = it }.onFailure { error = it.message }
                            working = false
                        }
                    },
                    enabled = !working,
                    modifier = Modifier.padding(top = 12.dp),
                ) { Text(if (working) "Generating…" else "Generate summary") }
                ErrorText(error)
                if (summary.isNotBlank()) Text(summary, modifier = Modifier.padding(top = 12.dp))
            }
        }
        item {
            SectionCard {
                Text("How this stays honest", style = MaterialTheme.typography.titleMedium)
                Text("Drift does not infer a mood, streak, or trend from missing data. The numbers above come from entries stored on this device.", modifier = Modifier.padding(top = 6.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
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
    while (cursor in dates) { streak++; cursor = cursor.minusDays(1) }
    return streak
}
