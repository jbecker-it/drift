package com.jbeckerit.drift

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.ui.Modifier
import androidx.compose.foundation.layout.padding
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.jbeckerit.drift.data.OnboardingSettings
import com.jbeckerit.drift.ui.CoachScreen
import com.jbeckerit.drift.ui.DriftScaffold
import com.jbeckerit.drift.ui.DriftTheme
import com.jbeckerit.drift.ui.JournalEditorScreen
import com.jbeckerit.drift.ui.JournalScreen
import com.jbeckerit.drift.ui.OnboardingScreen
import com.jbeckerit.drift.ui.ReflectScreen
import com.jbeckerit.drift.ui.SettingsScreen
import com.jbeckerit.drift.ui.TasksScreen
import com.jbeckerit.drift.ui.TodayScreen

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val container = (application as DriftApplication).container
        setContent {
            val settings by container.settings.state.collectAsStateWithLifecycle()
            DriftTheme(darkTheme = isSystemInDarkTheme()) {
                DriftApp(
                    container = container,
                    onboardingComplete = settings.onboarding.completed,
                    completeOnboarding = { container.settings.saveOnboarding(OnboardingSettings(completed = true)) },
                )
            }
        }
    }
}

@Composable
private fun DriftApp(
    container: AppContainer,
    onboardingComplete: Boolean,
    completeOnboarding: () -> Unit,
) {
    val nav = rememberNavController()
    val snackbarHostState = remember { SnackbarHostState() }
    var firstDestination by rememberSaveable { mutableStateOf("today") }

    if (!onboardingComplete) {
        OnboardingScreen(
            onStartWriting = {
                firstDestination = "journal/new"
                completeOnboarding()
            },
            onStartToday = {
                firstDestination = "today"
                completeOnboarding()
            },
        )
        return
    }

    val route = nav.currentBackStackEntryAsState().value?.destination?.route
    val mainDestination = route in setOf("today", "journal", "reflect")
    DriftScaffold(nav = nav, showNavigation = mainDestination, snackbarHostState = snackbarHostState) { padding ->
        NavHost(
            navController = nav,
            startDestination = firstDestination,
            modifier = Modifier.padding(padding),
            enterTransition = { fadeIn(animationSpec = tween(180)) },
            exitTransition = { fadeOut(animationSpec = tween(120)) },
            popEnterTransition = { fadeIn(animationSpec = tween(160)) },
            popExitTransition = { fadeOut(animationSpec = tween(100)) },
        ) {
            composable("today") {
                TodayScreen(
                    container = container,
                    snackbarHostState = snackbarHostState,
                    onWrite = { nav.navigate("journal/new") },
                    onAllTasks = { nav.navigate("tasks") },
                    onSettings = { nav.navigate("settings") },
                )
            }
            composable("journal") {
                JournalScreen(
                    container = container,
                    onNew = { nav.navigate("journal/new") },
                    onOpen = { entryId -> nav.navigate("journal/edit/$entryId") },
                )
            }
            composable("journal/new") {
                JournalEditorScreen(container = container, entryId = null, onDone = { nav.popBackStack() })
            }
            composable("journal/edit/{entryId}") { entry ->
                JournalEditorScreen(
                    container = container,
                    entryId = entry.arguments?.getString("entryId"),
                    onDone = { nav.popBackStack() },
                )
            }
            composable("reflect") {
                ReflectScreen(container = container, onCoach = { nav.navigate("coach") })
            }
            composable("coach") {
                CoachScreen(container = container, onBack = { nav.popBackStack() })
            }
            composable("tasks") {
                TasksScreen(container = container, onBack = { nav.popBackStack() })
            }
            composable("settings") {
                SettingsScreen(container = container, onBack = { nav.popBackStack() })
            }
        }
    }
}
