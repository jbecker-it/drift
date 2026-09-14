package com.jbeckerit.drift.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SyncBundleTest {
    @Test fun `newer remote record wins a conflict`() {
        val local = task(updatedAt = 100, done = false)
        val remote = task(updatedAt = 200, done = true)
        val merged = SyncBundle.merge(SyncBundle(tasks = listOf(local)), SyncBundle(tasks = listOf(remote)))
        assertTrue(merged.tasks.single().done)
    }

    @Test fun `a newer tombstone prevents a task from returning`() {
        val local = task(updatedAt = 100, done = false)
        val remote = task(updatedAt = 150, done = false, deletedAt = 250)
        val merged = SyncBundle.merge(SyncBundle(tasks = listOf(local)), SyncBundle(tasks = listOf(remote)))
        assertEquals(250L, merged.tasks.single().deletedAt)
    }

    @Test fun `newer insight tombstone prevents stale analysis returning`() {
        val local = EntryTags(
            entryId = "entry-1",
            topicsJson = "[\"work\"]",
            moodWordsJson = "[]",
            tasksOpenJson = "[]",
            tasksDoneJson = "[]",
            peopleJson = "[]",
            oneLineSummary = "Work was busy.",
            taggedAt = 100,
            entryRevision = 1,
            updatedAt = 100,
        )
        val remote = local.copy(updatedAt = 200, deletedAt = 200)

        val merged = SyncBundle.merge(SyncBundle(entryTags = listOf(local)), SyncBundle(entryTags = listOf(remote)))

        assertEquals(200L, merged.entryTags.single().deletedAt)
    }

    private fun task(updatedAt: Long, done: Boolean, deletedAt: Long? = null) = Task(
        id = "task-1",
        text = "Walk",
        kind = TaskKind.TODO,
        dateKey = "2026-01-01",
        done = done,
        createdAt = 1,
        updatedAt = updatedAt,
        deletedAt = deletedAt,
    )
}
