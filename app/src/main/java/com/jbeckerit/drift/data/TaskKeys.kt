package com.jbeckerit.drift.data

import java.time.Duration
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.temporal.WeekFields

object TaskKeys {
    val slots = listOf("morning", "midday", "afternoon", "night")
    fun today(zone: ZoneId = ZoneId.systemDefault()) = LocalDate.now(zone).toString()
    fun week(date: LocalDate = LocalDate.now()): String {
        val iso = WeekFields.ISO
        return "%04d-W%02d".format(date.get(iso.weekBasedYear()), date.get(iso.weekOfWeekBasedYear()))
    }
    fun dailyId(templateId: String, date: String, slot: String) = "daily:$templateId:$date:$slot"
    fun weeklyId(templateId: String, week: String, number: Int) = "weekly:$templateId:$week:$number"
    fun toNextDate(now: ZonedDateTime = ZonedDateTime.now()) =
        Duration.between(now, now.toLocalDate().plusDays(1).atStartOfDay(now.zone)).toMillis().coerceAtLeast(1_000)
}
