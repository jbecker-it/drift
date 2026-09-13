package com.jbeckerit.drift.reminders

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import com.jbeckerit.drift.data.ReminderSettings
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId

class ReminderScheduler(private val context: Context) {
    private val alarms = context.getSystemService(AlarmManager::class.java)

    fun scheduleAll(settings: ReminderSettings) {
        KINDS.forEach(::cancel)
        if (!settings.enabled) return
        schedule("morning", settings.morning)
        schedule("evening", settings.evening)
        schedule("tasks", settings.taskTime)
    }

    private fun schedule(kind: String, time: String) {
        val whenAt = next(time)
        val pending = pending(kind)
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarms.canScheduleExactAlarms()) {
            alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, whenAt, pending)
        } else {
            alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, whenAt, pending)
        }
    }

    private fun cancel(kind: String) = alarms.cancel(pending(kind))
    private fun pending(kind: String): PendingIntent = PendingIntent.getBroadcast(
        context,
        kind.hashCode(),
        Intent(context, ReminderReceiver::class.java).putExtra(ReminderReceiver.KIND, kind),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    private fun next(raw: String): Long {
        val time = runCatching { LocalTime.parse(raw) }.getOrDefault(LocalTime.of(8, 0))
        val zone = ZoneId.systemDefault()
        var date = LocalDate.now(zone)
        if (!date.atTime(time).atZone(zone).toInstant().isAfter(java.time.Instant.now())) date = date.plusDays(1)
        return date.atTime(time).atZone(zone).toInstant().toEpochMilli()
    }

    private companion object { val KINDS = listOf("morning", "evening", "tasks") }
}
