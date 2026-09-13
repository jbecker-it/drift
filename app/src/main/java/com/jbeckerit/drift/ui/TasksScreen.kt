package com.jbeckerit.drift.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.jbeckerit.drift.AppContainer
import com.jbeckerit.drift.data.Task
import com.jbeckerit.drift.data.TaskKeys
import com.jbeckerit.drift.data.TemplateKind
import kotlinx.coroutines.launch

@Composable
fun TasksScreen(container: AppContainer) {
    val repository = container.repository
    val scope = rememberCoroutineScope()
    val today by repository.observeToday().collectAsStateWithLifecycle(initialValue = emptyList())
    val weekly by repository.observeWeekly().collectAsStateWithLifecycle(initialValue = emptyList())
    val todos by repository.observeTodos().collectAsStateWithLifecycle(initialValue = emptyList())
    val templates by repository.observeTemplates().collectAsStateWithLifecycle(initialValue = emptyList())
    var add by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { repository.ensureCurrent() }

    val targetByTemplate = templates.associate { it.id to (it.weeklyTarget ?: 1) }
    androidx.compose.foundation.lazy.LazyColumn(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(start = 20.dp, end = 20.dp, bottom = 24.dp),
    ) {
        item {
            ScreenTitle("Tasks", "Small, visible commitments for this day and week.") {
                Button(onClick = { add = true }) { Text("Add") }
            }
        }
        TaskKeys.slots.forEach { slot ->
            val rows = today.filter { it.slot == slot }
            item {
                SectionCard {
                    Text(slot.replaceFirstChar { it.uppercase() }, style = MaterialTheme.typography.titleMedium)
                    if (rows.isEmpty()) EmptyState("No routine set for this part of the day.")
                    rows.forEach { TaskLine(it, onToggle = { scope.launch { repository.toggleTask(it.id) } }, onDelete = { scope.launch { repository.deleteTask(it.id) } }) }
                }
            }
        }
        val custom = today.filter { it.slot == null }
        item {
            SectionCard {
                Text("Today", style = MaterialTheme.typography.titleMedium)
                if (custom.isEmpty()) EmptyState("No one-off tasks for today.")
                custom.forEach { TaskLine(it, onToggle = { scope.launch { repository.toggleTask(it.id) } }, onDelete = { scope.launch { repository.deleteTask(it.id) } }) }
            }
        }
        item {
            SectionCard {
                Text("This week", style = MaterialTheme.typography.titleMedium)
                if (weekly.isEmpty()) EmptyState("Add a weekly goal to turn a larger intention into a handful of checkboxes.")
                weekly.forEach { task ->
                    val target = task.templateId?.let(targetByTemplate::get) ?: 1
                    TaskLine(task, detail = "$target× this week", onToggle = { scope.launch { repository.toggleTask(task.id) } }, onDelete = { scope.launch { repository.deleteTask(task.id) } })
                }
            }
        }
        item {
            SectionCard {
                Text("To-dos", style = MaterialTheme.typography.titleMedium)
                if (todos.isEmpty()) EmptyState("Persistent tasks stay here until you finish or delete them.")
                todos.forEach { task ->
                    TaskLine(task, detail = task.dueDate?.let { "Due $it" }, onToggle = { scope.launch { repository.toggleTask(task.id) } }, onDelete = { scope.launch { repository.deleteTask(task.id) } })
                }
            }
        }
        item {
            SectionCard {
                Text("Routines", style = MaterialTheme.typography.titleMedium)
                if (templates.isEmpty()) EmptyState("Create a daily routine or a weekly target from Add.")
                templates.forEach { template ->
                    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(template.text)
                            val description = if (template.kind == TemplateKind.DAILY) template.slotsCsv.replace(',', ' ') else "${template.weeklyTarget ?: 1}× per week"
                            Text(description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        TextButton(onClick = { scope.launch { repository.deleteTemplate(template.id) } }) { Text("Remove") }
                    }
                }
            }
        }
    }
    if (add) TaskCreateDialog(
        onDismiss = { add = false },
        onAdd = { kind, text, slots, target, due ->
            when (kind) {
                "daily" -> repository.createDaily(text, slots.toList())
                "weekly" -> repository.createWeekly(text, target)
                "todo" -> repository.createOneOff(text, todo = true, dueDate = due)
                else -> repository.createOneOff(text, todo = false)
            }
        },
    )
}

@Composable
private fun TaskLine(task: Task, detail: String? = null, onToggle: () -> Unit, onDelete: () -> Unit) {
    Row(modifier = Modifier.fillMaxWidth().padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Checkbox(checked = task.done, onCheckedChange = { onToggle() })
        Column(Modifier.weight(1f).padding(start = 4.dp)) {
            Text(task.text, color = if (task.done) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface)
            if (!detail.isNullOrBlank()) Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        TextButton(onClick = onDelete, modifier = Modifier.width(72.dp)) { Text("Delete") }
    }
}

@Composable
private fun TaskCreateDialog(onDismiss: () -> Unit, onAdd: suspend (String, String, Set<String>, Int, String?) -> Unit) {
    val scope = rememberCoroutineScope()
    var kind by remember { mutableStateOf("one") }
    var text by remember { mutableStateOf("") }
    var slots by remember { mutableStateOf(setOf("morning")) }
    var target by remember { mutableStateOf("3") }
    var due by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Add a task") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.verticalScroll(rememberScrollState())) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf("one" to "Today", "todo" to "To-do", "daily" to "Routine", "weekly" to "Weekly").forEach { (value, label) ->
                        FilterChip(selected = kind == value, onClick = { kind = value }, label = { Text(label) })
                    }
                }
                OutlinedTextField(value = text, onValueChange = { text = it; error = null }, label = { Text("Task") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                if (kind == "daily") {
                    Text("Show it at", style = MaterialTheme.typography.labelLarge)
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        TaskKeys.slots.forEach { slot ->
                            FilterChip(selected = slot in slots, onClick = {
                                slots = if (slot in slots) slots - slot else slots + slot
                            }, label = { Text(slot.take(3)) })
                        }
                    }
                }
                if (kind == "weekly") OutlinedTextField(value = target, onValueChange = { target = it }, label = { Text("Times this week (1–7)") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                if (kind == "todo") OutlinedTextField(value = due, onValueChange = { due = it }, label = { Text("Optional due date (YYYY-MM-DD)") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                ErrorText(error)
            }
        },
        confirmButton = {
            Button(onClick = {
                scope.launch {
                    saving = true
                    runCatching { onAdd(kind, text, slots, target.toIntOrNull() ?: 1, due.ifBlank { null }) }
                        .onSuccess { onDismiss() }
                        .onFailure { error = it.message ?: "Could not add task." }
                    saving = false
                }
            }, enabled = !saving) { Text(if (saving) "Adding…" else "Add") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
