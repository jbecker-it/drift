package com.jbeckerit.drift.reminders

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.jbeckerit.drift.DriftApplication
import com.jbeckerit.drift.MainActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

object NotificationChannels {
    const val JOURNAL = "journal_reminders"
    const val TASKS = "task_reminders"

    fun create(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannels(listOf(
            NotificationChannel(JOURNAL, "Journal reminders", NotificationManager.IMPORTANCE_DEFAULT).apply { description = "Gentle prompts to write in Drift" },
            NotificationChannel(TASKS, "Task reminders", NotificationManager.IMPORTANCE_DEFAULT).apply { description = "Prompts for unfinished Drift tasks" },
        ))
    }
}

class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val pending = goAsync()
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            try {
                val app = context.applicationContext as DriftApplication
                val kind = intent.getStringExtra(KIND).orEmpty()
                val body = when (kind) {
                    "morning" -> "A few honest lines are enough. How are you arriving today?"
                    "evening" -> if (!app.container.repository.hasEntryToday()) "The day is nearly over. Want to leave yourself a few words?" else null
                    "tasks" -> taskMessage(app)
                    else -> null
                }
                if (body != null) notify(context, kind, body)
                app.container.reminders.scheduleAll(app.container.settings.current().reminders)
            } finally {
                pending.finish()
            }
        }
    }

    private suspend fun taskMessage(app: DriftApplication): String? {
        val daily = app.container.repository.unfinishedToday()
        val todos = app.container.repository.unfinishedTodos()
        val count = daily.size + todos.size
        return if (count == 0) null else "$count unfinished ${if (count == 1) "task" else "tasks"} are waiting. Pick one small next step."
    }

    private fun notify(context: Context, kind: String, body: String) {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val task = kind == "tasks"
        val notification = NotificationCompat.Builder(context, if (task) NotificationChannels.TASKS else NotificationChannels.JOURNAL)
            .setSmallIcon(com.jbeckerit.drift.R.drawable.ic_drift)
            .setContentTitle(if (task) "Drift tasks" else "Drift")
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(PendingIntent.getActivity(context, kind.hashCode(), Intent(context, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
            .setAutoCancel(true)
            .build()
        NotificationManagerCompat.from(context).notify(kind.hashCode(), notification)
    }

    companion object { const val KIND = "kind" }
}
