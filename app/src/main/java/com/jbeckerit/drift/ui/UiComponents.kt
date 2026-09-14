package com.jbeckerit.drift.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Home
import androidx.compose.material.icons.rounded.MenuBook
import androidx.compose.material.icons.rounded.RadioButtonUnchecked
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import androidx.navigation.compose.currentBackStackEntryAsState
import com.jbeckerit.drift.data.Task
import java.text.DateFormat
import java.util.Date

private data class Destination(val route: String, val label: String, val icon: ImageVector)

private val destinations = listOf(
    Destination("today", "Today", Icons.Rounded.Home),
    Destination("journal", "Journal", Icons.Rounded.MenuBook),
    Destination("reflect", "Reflect", Icons.Rounded.AutoAwesome),
)

@Composable
fun DriftScaffold(
    nav: NavHostController,
    showNavigation: Boolean,
    snackbarHostState: SnackbarHostState,
    content: @Composable (PaddingValues) -> Unit,
) {
    val route = nav.currentBackStackEntryAsState().value?.destination?.route
    androidx.compose.material3.Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        snackbarHost = { SnackbarHost(snackbarHostState) },
        bottomBar = {
            if (showNavigation) {
                NavigationBar(containerColor = MaterialTheme.colorScheme.surface) {
                    destinations.forEach { item ->
                        NavigationBarItem(
                            selected = route == item.route,
                            onClick = {
                                if (route != item.route) {
                                    nav.navigate(item.route) {
                                        popUpTo(nav.graph.startDestinationId) { saveState = true }
                                        launchSingleTop = true
                                        restoreState = true
                                    }
                                }
                            },
                            icon = { Icon(item.icon, contentDescription = null) },
                            label = { Text(item.label) },
                        )
                    }
                }
            }
        },
        content = content,
    )
}

@Composable
fun ScreenTitle(title: String, subtitle: String, action: (@Composable () -> Unit)? = null) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(start = DriftSpace.xLarge, end = DriftSpace.xLarge, top = DriftSpace.xLarge, bottom = DriftSpace.medium),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.headlineMedium)
            Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (action != null) {
            Spacer(Modifier.width(DriftSpace.medium))
            action()
        }
    }
}

@Composable
fun SectionCard(
    modifier: Modifier = Modifier,
    emphasized: Boolean = false,
    content: @Composable ColumnScope.() -> Unit,
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.large,
        colors = CardDefaults.cardColors(
            containerColor = if (emphasized) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface,
            contentColor = if (emphasized) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurface,
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = if (emphasized) 2.dp else 0.dp),
    ) {
        Column(Modifier.padding(DriftSpace.large), content = content)
    }
}

@Composable
fun EmptyState(text: String) {
    Text(text, modifier = Modifier.padding(vertical = DriftSpace.small), color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable
fun ErrorText(text: String?) {
    if (!text.isNullOrBlank()) {
        Text(text, modifier = Modifier.padding(top = DriftSpace.small), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
fun SavedEntryRow(title: String, subtitle: String, onClick: () -> Unit) {
    Surface(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        color = MaterialTheme.colorScheme.surface,
        shape = MaterialTheme.shapes.medium,
    ) {
        Column(Modifier.padding(horizontal = DriftSpace.large, vertical = DriftSpace.medium)) {
            Text(title, fontWeight = FontWeight.SemiBold)
            Text(
                subtitle.ifBlank { "Mood-only entry" },
                maxLines = 2,
                modifier = Modifier.padding(top = DriftSpace.xSmall),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
fun TaskRow(
    task: Task,
    detail: String? = null,
    onToggle: () -> Unit,
    trailing: (@Composable () -> Unit)? = null,
) {
    val contentColor by animateColorAsState(
        targetValue = if (task.done) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
        label = "task content color",
    )
    Surface(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onToggle),
        color = if (task.done) MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.48f) else MaterialTheme.colorScheme.surface,
        shape = MaterialTheme.shapes.medium,
    ) {
        Row(
            modifier = Modifier.padding(start = DriftSpace.small, end = DriftSpace.small, top = DriftSpace.small, bottom = DriftSpace.small),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onToggle) {
                Icon(
                    imageVector = if (task.done) Icons.Rounded.CheckCircle else Icons.Rounded.RadioButtonUnchecked,
                    contentDescription = if (task.done) "Mark ${task.text} incomplete" else "Mark ${task.text} complete",
                    tint = if (task.done) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline,
                )
            }
            Column(Modifier.weight(1f).padding(start = DriftSpace.xSmall, end = DriftSpace.small)) {
                Text(
                    task.text,
                    color = contentColor,
                    style = MaterialTheme.typography.bodyLarge,
                    textDecoration = if (task.done) TextDecoration.LineThrough else null,
                )
                if (!detail.isNullOrBlank()) {
                    Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            trailing?.invoke()
        }
    }
}

fun formatDate(time: Long): String = DateFormat.getDateInstance(DateFormat.MEDIUM).format(Date(time))
