package com.jbeckerit.drift.data

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime

class TaskKeysTest {
    @Test fun `ISO week uses the week based year at new year`() {
        assertEquals("2025-W01", TaskKeys.week(LocalDate.parse("2024-12-30")))
        assertEquals("2026-W01", TaskKeys.week(LocalDate.parse("2025-12-29")))
    }

    @Test fun `task ids are stable and scoped to their period`() {
        assertEquals("daily:water:2026-01-03:morning", TaskKeys.dailyId("water", "2026-01-03", "morning"))
        assertEquals("weekly:walk:2026-W01:2", TaskKeys.weeklyId("walk", "2026-W01", 2))
    }

    @Test fun `next date delay reaches local midnight`() {
        val zone = ZoneId.of("Europe/Berlin")
        val now = ZonedDateTime.of(2026, 3, 28, 23, 59, 0, 0, zone)
        assertEquals(60_000, TaskKeys.toNextDate(now))
    }
}
