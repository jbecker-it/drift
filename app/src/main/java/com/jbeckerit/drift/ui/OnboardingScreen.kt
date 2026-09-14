package com.jbeckerit.drift.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.MenuBook
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight

@Composable
fun OnboardingScreen(onStartWriting: () -> Unit, onStartToday: () -> Unit) {
    var page by rememberSaveable { mutableStateOf(0) }

    androidx.compose.material3.Scaffold(containerColor = MaterialTheme.colorScheme.background) { padding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(padding).padding(horizontal = DriftSpace.xLarge),
            verticalArrangement = Arrangement.Center,
        ) {
            if (page == 0) {
                Icon(
                    Icons.Rounded.AutoAwesome,
                    contentDescription = null,
                    modifier = Modifier.padding(bottom = DriftSpace.large),
                    tint = MaterialTheme.colorScheme.primary,
                )
                Text("Welcome to Drift", style = MaterialTheme.typography.displaySmall)
                Text(
                    "A private place to notice what matters, one small step at a time.",
                    modifier = Modifier.padding(top = DriftSpace.medium),
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(DriftSpace.xxLarge))
                WelcomePoint("Your writing stays on your phone by default.")
                WelcomePoint("There are no accounts, feeds, or scores to keep up with.")
                WelcomePoint("AI and reminders stay off until you choose them.")
                Spacer(Modifier.height(DriftSpace.xxLarge))
                Button(onClick = { page = 1 }, modifier = Modifier.fillMaxWidth()) { Text("Continue") }
            } else {
                Text("Where would you like to begin?", style = MaterialTheme.typography.headlineMedium)
                Text(
                    "You can change everything later. There is no setup to get through first.",
                    modifier = Modifier.padding(top = DriftSpace.small),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(DriftSpace.xLarge))
                StartChoice(
                    icon = Icons.Rounded.MenuBook,
                    title = "Write a few words",
                    description = "Start with whatever is on your mind.",
                    onClick = onStartWriting,
                )
                Spacer(Modifier.height(DriftSpace.medium))
                StartChoice(
                    icon = Icons.Rounded.CheckCircle,
                    title = "See today first",
                    description = "Create a small task when it feels useful.",
                    onClick = onStartToday,
                )
                Spacer(Modifier.height(DriftSpace.xLarge))
                OutlinedButton(onClick = onStartToday, modifier = Modifier.fillMaxWidth()) { Text("I'll look around first") }
            }
        }
    }
}

@Composable
private fun WelcomePoint(text: String) {
    Text(
        "•  $text",
        modifier = Modifier.padding(bottom = DriftSpace.medium),
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

@Composable
private fun StartChoice(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    description: String,
    onClick: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        shape = MaterialTheme.shapes.large,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(Modifier.padding(DriftSpace.large)) {
            Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
            Text(title, modifier = Modifier.padding(top = DriftSpace.medium), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
            Text(description, modifier = Modifier.padding(top = DriftSpace.xSmall), color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
