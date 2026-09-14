@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.jbeckerit.drift.ui

import android.view.HapticFeedbackConstants
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.weight
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalView
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.jbeckerit.drift.AppContainer
import com.jbeckerit.drift.data.Task
import com.jbeckerit.drift.data.TaskKeys
import com.jbeckerit.drift.data.TemplateKind
import kotlinx.coroutines.launch

@Composable
fun TasksScreen(container: AppContainer, onBack: () -> Unit) {
    val repository = container.repository
    val scope = rememberCoroutineScope()
    val view = LocalView.current
    val today by repository.observeToday().collectAsStateWithLifecycle(initialValue = emptyList())
    val weekly by repository.observeWeekly().collectAsStateWithLifecycle(initialValue = emptyList())
    val todos by repository.observeTodos().collectAsStateWithLifecycle(initialValue = emptyList())
    val templates by repository.observeTemplates().collectAsStateWithLifecycle(initialValue = emptyList())
    var add by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { repository.ensureCurrent() }
    val targetByTemplate = templates.associate { it.id to (it.weeklyTarget ?: 1) }

    Column(Modifier.fillMaxSize()) {
        TopAppBar(
            title = {
                Column {
                    Text("All tasks")
                    Text("Keep only what helps in view.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            },
            navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "Back") } },
            actions = { IconButton(onClick = { add = true }) { Icon(Icons.Rounded.Add, contentDescription = "Add a task") } },
        )
        androidx.compose.foundation.lazy.LazyColumn(
            modifier = Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.spacedBy(DriftSpace.medium),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(start = DriftSpace.xLarge, end = DriftSpace.xLarge, bottom = DriftSpace.xLarge),
        ) {
            TaskKeys.slots.forEach { slot ->
                val rows = today.filter { it.slot == slot }
                if (rows.isNotEmpty()) {
                    item {
                        TaskSection(slot.replaceFirstChar { it.uppercase() }) {
                            rows.forEach { task ->
                                TaskWithMenu(
                                    task = task,
                                    onToggle = {
                                        scope.launch {
                                            val completing = !task.done
                                            repository.toggleTask(task.id)
                                            if (completing) view.performHapticFeedback(HapticFeedbackConstants.CONFIRM)
                                        }
                                    },
                                    onDelete = { scope.launch { repository.deleteTask(task.id) } },
                                )
                            }
                        }
                    }
                }
            }
            val custom = today.filter { it.slot == null }
            if (custom.isNotEmpty()) item {
                TaskSection("Today") {
                    custom.forEach { task ->
                        TaskWithMenu(task, onToggle = { scope.launch { repository.toggleTask(task.id) } }, onDelete = { scope.launch { repository.deleteTask(task.id) } })
                    }
                }
            }
            if (weekly.isNotEmpty()) item {
                TaskSection("This week") {
                    weekly.forEach { task ->
                        val target = task.templateId?.let(targetByTemplate::get) ?: 1
                        TaskWithMenu(task, detail = "$target× this week", onToggle = { scope.launch { repository.toggleTask(task.id) } }, onDelete = { scope.launch { repository.deleteTask(task.id) } })
                    }
                }
            }
            if (todos.isNotEmpty()) item {
                TaskSection("To-dos") {
                    todos.forEach { task ->
                        TaskWithMenu(task, detail = task.dueDate?.let { "Due $it" }, onToggle = { scope.launch { repository.toggleTask(task.id) } }, onDelete = { scope.launch { repository.deleteTask(task.id) } })
                    }
                }
            }
            if (today.isEmpty() && weekly.isEmpty() && todos.isEmpty()) item {
                SectionCard(emphasized = true) {
                    Text("Nothing is waiting for you.", style = MaterialTheme.typography.titleLarge)
                    Text("Add a task only when it will make the next step easier.", modifier = Modifier.padding(top = DriftSpace.xSmall), color = MaterialTheme.colorScheme.onPrimaryContainer)
                    Button(onClick = { add = true }, modifier = Modifier.padding(top = DriftSpace.large)) { Text("Add something small") }
                }
            }
            if (templates.isNotEmpty()) item {
                TaskSection("Routines") {
                    templates.forEach { template ->
                        Row(modifier = Modifier.fillMaxWidth().padding(vertical = DriftSpace.small)) {
                            Column(Modifier.weight(1f)) {
                                Text(template.text, style = MaterialTheme.typography.bodyLarge)
                                Text(
                                    if (template.kind == TemplateKind.DAILY) template.slotsCsv.replace(',', ' ') else "${template.weeklyTarget ?: 1}× per week",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            TextButton(onClick = { scope.launch { repository.deleteTemplate(template.id) } }) { Text("Remove") }
                        }
                    }
                }
            }
        }
    }
    if (add) {
        TaskCreateDialog(
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
}

@Composable
private fun TaskSection(title: String, content: @Composable () -> Unit) {
    SectionCard {
        Text(title, style = MaterialTheme.typography.titleMedium)
        Column(verticalArrangement = Arrangement.spacedBy(DriftSpace.small), modifier = Modifier.padding(top = DriftSpace.small)) { content() }
    }
}

@Composable
private fun TaskWithMenu(task: Task, detail: String? = null, onToggle: () -> Unit, onDelete: () -> Unit) {
    var menuOpen by remember { mutableStateOf(false) }
    TaskRow(task = task, detail = detail, onToggle = onToggle, onMore = { menuOpen = true })
    DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
        DropdownMenuItem(
            text = { Text("Remove task") },
            onClick = { menuOpen = false; onDelete() },
        )
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
            Column(verticalArrangement = Arrangement.spacedBy(DriftSpace.medium), modifier = Modifier.verticalScroll(rememberScrollState())) {
                Row(horizontalArrangement = Arrangement.spacedBy(DriftSpace.small)) {
                    listOf("one" to "Today", "todo" to "To-do", "daily" to "Routine", "weekly" to "Weekly").forEach { (value, label) ->
                        FilterChip(selected = kind == value, onClick = { kind = value }, label = { Text(label) })
                    }
                }
                OutlinedTextField(value = text, onValueChange = { text = it; error = null }, label = { Text("What would help?") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                if (kind == "daily") {
                    Text("Show it at", style = MaterialTheme.typography.labelLarge)
                    Row(horizontalArrangement = Arrangement.spacedBy(DriftSpace.small)) {
                        TaskKeys.slots.forEach { slot ->
                            FilterChip(
                                selected = slot in slots,
                                onClick = { slots = if (slot in slots) slots - slot else slots + slot },
                                label = { Text(slot.take(3)) },
                            )
                        }
                    }
                }
                if (kind == "weekly") OutlinedTextField(value = target, onValueChange = { target = it }, label = { Text("Times this week (1–7)") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                if (kind == "todo") OutlinedTextField(value = due, onValueChange = { due = it }, label = { Text("Due date, optional (YYYY-MM-DD)") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                ErrorText(error)
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    scope.launch {
                        saving = true
                        runCatching { onAdd(kind, text, slots, target.toIntOrNull() ?: 1, due.ifBlank { null }) }
                            .onSuccess { onDismiss() }
                            .onFailure { error = it.message ?: "Could not add that task." }
                        saving = false
                    }
                },
                enabled = !saving,
            ) { Text(if (saving) "Adding…" else "Add") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
