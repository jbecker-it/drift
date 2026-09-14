package com.jbeckerit.drift.data

import java.time.LocalDate
import java.time.temporal.ChronoUnit

data class GentleStreak(val current: Int, val longest: Int, val lastEntryDate: LocalDate?)

/** Keeps a single missed day from erasing a developing writing rhythm. */
object GentleStreaks {
    fun calculate(entryDates: Collection<LocalDate>, today: LocalDate = LocalDate.now()): GentleStreak {
        val dates = entryDates.filter { !it.isAfter(today) }.distinct().sorted()
        val latest = dates.lastOrNull() ?: return GentleStreak(0, 0, null)
        val current = if (latest == today || latest == today.minusDays(1)) countBackward(dates.asReversed()) else 0
        return GentleStreak(current, longest(dates), latest)
    }

    private fun countBackward(dates: List<LocalDate>): Int {
        var count = 1
        var anchor = dates.first()
        var gapUsed = false
        for (date in dates.drop(1)) {
            when (ChronoUnit.DAYS.between(date, anchor)) {
                1L -> count++
                2L -> if (!gapUsed) {
                    count++
                    gapUsed = true
                } else break
                else -> break
            }
            anchor = date
        }
        return count
    }

    private fun longest(dates: List<LocalDate>): Int {
        if (dates.isEmpty()) return 0
        var best = 1
        var current = 1
        var previous = dates.first()
        var gapUsed = false
        for (date in dates.drop(1)) {
            when (ChronoUnit.DAYS.between(previous, date)) {
                1L -> current++
                2L -> if (!gapUsed) {
                    current++
                    gapUsed = true
                } else {
                    current = 1
                    gapUsed = false
                }
                else -> {
                    current = 1
                    gapUsed = false
                }
            }
            best = maxOf(best, current)
            previous = date
        }
        return best
    }
}
