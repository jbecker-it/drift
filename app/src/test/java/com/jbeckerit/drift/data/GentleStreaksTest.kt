package com.jbeckerit.drift.data

import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Test

class GentleStreaksTest {
    private val today = LocalDate.of(2026, 9, 13)

    @Test fun `one missed day keeps a current rhythm alive`() {
        val result = GentleStreaks.calculate(listOf(today, today.minusDays(2), today.minusDays(3)), today)

        assertEquals(3, result.current)
        assertEquals(3, result.longest)
    }

    @Test fun `a second missed day starts a new sequence`() {
        val result = GentleStreaks.calculate(listOf(today, today.minusDays(2), today.minusDays(4)), today)

        assertEquals(2, result.current)
        assertEquals(2, result.longest)
    }
}
