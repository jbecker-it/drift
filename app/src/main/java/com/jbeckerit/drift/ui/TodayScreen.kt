package com.jbeckerit.drift.ui

import android.view.HapticFeedbackConstants
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.weight
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.ArrowForward
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material3.Button
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.jbeckerit.drift.AppContainer
import com.jbeckerit.drift.data.Task
import com.jbeckerit.drift.data.TaskSource
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.format.DateTimeFormatter

@Composable
fun TodayScreen(
    container: AppContainer,
    snackbarHostState: SnackbarHostState,
    onWrite: () -> Unit,
    onAllTasks: () -> Unit,
    onSettings: () -> Unit,
) {
    val repository = container.repository
    val scope = rememberCoroutineScope()
    val view = LocalView.current
    val today by repository.observeToday().collectAsStateWithLifecycle(initialValue = emptyList())
    val todos by repository.observeTodos().collectAsStateWithLifecycle(initialValue = emptyList())
    val templates by repository.observeTemplates().collectAsStateWithLifecycle(initialValue = emptyList())
    val entries by repository.observeEntries().collectAsStateWithLifecycle(initialValue = emptyList())
    val currentSlot = remember { currentSlot() }

    LaunchedEffect(Unit) { repository.ensureCurrent() }

    val orderedToday = remember(today, templates) {
        val templateOrder = templates.associate { it.id to it.sortOrder }
        today.sortedWith(compareBy<Task> { it.done }.thenBy { templateOrder[it.templateId] ?: Int.MAX_VALUE }.thenBy { it.createdAt })
    }
    val todayKey = LocalDate.now().toString()
    val dueTodos = remember(todos, todayKey) { todos.filter { it.dueDate != null && it.dueDate <= todayKey } }
    val visibleTasks = remember(orderedToday, dueTodos, currentSlot) {
        val currentRoutine = orderedToday.filter { !it.done && it.slot == currentSlot }
        val oneOff = orderedToday.filter { !it.done && it.slot == null }
        (currentRoutine + oneOff + dueTodos.filterNot(Task::done)).distinctBy(Task::id).take(3)
    }
    val todayWork = remember(orderedToday, dueTodos) { orderedToday + dueTodos }
    val allActionable = remember(todayWork) { todayWork.filterNot(Task::done) }
    val completed = remember(todayWork) { todayWork.count(Task::done) }
    val total = todayWork.size
    val hasWrittenToday = remember(entries) {
        val localToday = LocalDate.now()
        entries.any { entry -> Instant.ofEpochMilli(entry.createdAt).atZone(java.time.ZoneId.systemDefault()).toLocalDate() == localToday }
    }

    androidx.compose.foundation.lazy.LazyColumn(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(DriftSpace.medium),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(start = DriftSpace.xLarge, end = DriftSpace.xLarge, bottom = DriftSpace.xLarge),
    ) {
        item {
            ScreenTitle(
                title = greeting(),
                subtitle = LocalDate.now().format(DateTimeFormatter.ofPattern("EEEE, d MMMM")),
                action = { IconButton(onClick = onSettings) { Icon(Icons.Rounded.Settings, contentDescription = "Settings") } },
            )
        }
        item {
            SectionCard(emphasized = true) {
                Text(if (hasWrittenToday) "You made space for yourself today." else "A few honest words can be enough.", style = MaterialTheme.typography.titleLarge)
                Text(
                    if (hasWrittenToday) "Come back whenever another thought wants somewhere to land." else "No format, no pressure. Start wherever you are.",
                    modifier = Modifier.padding(top = DriftSpace.xSmall),
                    color = MaterialTheme.colorScheme.onPrimaryContainer,
                )
                Button(onClick = onWrite, modifier = Modifier.fillMaxWidth().padding(top = DriftSpace.large)) {
                    Icon(Icons.Rounded.Add, contentDescription = null)
                    Text(if (hasWrittenToday) "Write again" else "Write a few words", modifier = Modifier.padding(start = DriftSpace.small))
                }
            }
        }
        item {
            Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Your next few things", style = MaterialTheme.typography.titleLarge)
                    Text(
                        if (total == 0) "Add something only when it will help." else "$completed of $total complete today",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                TextButton(onClick = onAllTasks) {
                    Text("All tasks")
                    Icon(Icons.Rounded.ArrowForward, contentDescription = null, modifier = Modifier.padding(start = DriftSpace.xSmall).size(18.dp))
                }
            }
        }
        if (total > 0) {
            item {
                LinearProgressIndicator(
                    progress = if (total == 0) 0f else completed.toFloat() / total,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
        if (visibleTasks.isEmpty()) {
            item {
                SectionCard {
                    Text(
                        if (allActionable.isEmpty()) "Nothing else needs your attention right now." else "You have a clear moment. The rest is safely in All tasks.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (allActionable.isEmpty()) {
                        FilledTonalButton(onClick = onAllTasks, modifier = Modifier.padding(top = DriftSpace.medium)) {
                            Text("Add a small task")
                        }
                    }
                }
            }
        } else {
            items(visibleTasks, key = { it.id }) { task ->
                TaskRow(
                    task = task,
                    detail = taskDetail(task),
                    onToggle = {
                        scope.launch {
                            val completing = !task.done
                            repository.toggleTask(task.id)
                            if (completing) {
                                view.performHapticFeedback(HapticFeedbackConstants.CONFIRM)
                                val result = snackbarHostState.showSnackbar(
                                    message = "A small win.",
                                    actionLabel = "Undo",
                                )
                                if (result == SnackbarResult.ActionPerformed) repository.toggleTask(task.id)
                            }
                        }
                    },
                )
            }
        }
        item {
            AnimatedVisibility(visible = total > 0 && completed == total) {
                SectionCard {
                    Text("That is enough for now.", style = MaterialTheme.typography.titleMedium)
                    Text("Everything you chose for today is complete.", modifier = Modifier.padding(top = DriftSpace.xSmall), color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}

private fun currentSlot(now: LocalTime = LocalTime.now()): String = when {
    now.hour < 12 -> "morning"
    now.hour < 14 -> "midday"
    now.hour < 18 -> "afternoon"
    else -> "night"
}

private fun greeting(hour: Int = LocalTime.now().hour): String = when {
    hour < 12 -> "Good morning"
    hour < 18 -> "Good afternoon"
    else -> "Good evening"
}

private fun taskDetail(task: Task): String? = when {
    task.slot != null -> task.slot.replaceFirstChar { it.uppercase() }
    task.dueDate != null && task.dueDate < LocalDate.now().toString() -> "Overdue · ${task.dueDate}"
    task.dueDate != null && task.dueDate == LocalDate.now().toString() -> "Due today"
    task.dueDate != null -> "Due ${task.dueDate}"
    task.weekKey != null -> "This week"
    task.source == TaskSource.EXTRACTED -> "From your journal"
    else -> null
}
