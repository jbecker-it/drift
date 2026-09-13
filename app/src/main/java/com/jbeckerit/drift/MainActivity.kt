package com.jbeckerit.drift

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.jbeckerit.drift.ui.CoachScreen
import com.jbeckerit.drift.ui.DriftScaffold
import com.jbeckerit.drift.ui.InsightsScreen
import com.jbeckerit.drift.ui.JournalScreen
import com.jbeckerit.drift.ui.SettingsScreen
import com.jbeckerit.drift.ui.TasksScreen

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val container = (application as DriftApplication).container
        setContent {
            DriftTheme {
                val nav = rememberNavController()
                DriftScaffold(nav) { padding ->
                    NavHost(navController = nav, startDestination = "journal", modifier = androidx.compose.ui.Modifier.padding(padding)) {
                        composable("journal") { JournalScreen(container) }
                        composable("tasks") { TasksScreen(container) }
                        composable("coach") { CoachScreen(container) }
                        composable("insights") { InsightsScreen(container) }
                        composable("settings") { SettingsScreen(container) }
                    }
                }
            }
        }
    }
}

@Composable
private fun DriftTheme(content: @Composable () -> Unit) {
    val palette = darkColorScheme(
        primary = Color(0xFF9ACBFF),
        onPrimary = Color(0xFF003258),
        primaryContainer = Color(0xFF124B77),
        secondary = Color(0xFF9AD8C3),
        tertiary = Color(0xFFFFC59B),
        background = Color(0xFF101417),
        surface = Color(0xFF171D21),
        surfaceVariant = Color(0xFF263137),
        onBackground = Color(0xFFE2E9ED),
        onSurface = Color(0xFFE2E9ED),
    )
    MaterialTheme(colorScheme = palette, content = content)
}
