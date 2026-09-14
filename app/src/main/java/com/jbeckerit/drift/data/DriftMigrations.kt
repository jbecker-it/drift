package com.jbeckerit.drift.data

import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

/**
 * Drift 2.2 keeps the first native release's journal data intact while adding
 * the PWA's structured insight records. New records use tombstones so WebDAV
 * can carry deletions safely between devices.
 */
val MIGRATION_1_2 = object : Migration(1, 2) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE entries ADD COLUMN wordCount INTEGER NOT NULL DEFAULT 0")
        db.execSQL("ALTER TABLE entries ADD COLUMN taggingStatus TEXT")
        db.execSQL("ALTER TABLE entries ADD COLUMN taggingError TEXT")
        db.execSQL("ALTER TABLE task_templates ADD COLUMN sortOrder INTEGER NOT NULL DEFAULT 0")
        db.execSQL("ALTER TABLE task_templates ADD COLUMN slotOrdersJson TEXT NOT NULL DEFAULT ''")
        db.execSQL("ALTER TABLE tasks ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'")
        db.execSQL("ALTER TABLE tasks ADD COLUMN entryId TEXT")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_tasks_entryId ON tasks (entryId)")

        db.execSQL(
            "CREATE TABLE IF NOT EXISTS entry_tags (entryId TEXT NOT NULL, topicsJson TEXT NOT NULL, sleepHours REAL, moodWordsJson TEXT NOT NULL, tasksOpenJson TEXT NOT NULL, tasksDoneJson TEXT NOT NULL, peopleJson TEXT NOT NULL, oneLineSummary TEXT NOT NULL, taggedAt INTEGER NOT NULL, entryRevision INTEGER NOT NULL, updatedAt INTEGER NOT NULL, deletedAt INTEGER, PRIMARY KEY(entryId))",
        )
        db.execSQL("CREATE INDEX IF NOT EXISTS index_entry_tags_updatedAt ON entry_tags (updatedAt)")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_entry_tags_deletedAt ON entry_tags (deletedAt)")

        db.execSQL(
            "CREATE TABLE IF NOT EXISTS context_memory (id TEXT NOT NULL, patternsJson TEXT NOT NULL, keyFactsJson TEXT NOT NULL, openLoopsJson TEXT NOT NULL, recentWinsJson TEXT NOT NULL, moodTrend TEXT NOT NULL, lastUpdated INTEGER NOT NULL, entryCount INTEGER NOT NULL, updatedAt INTEGER NOT NULL, deletedAt INTEGER, PRIMARY KEY(id))",
        )
        db.execSQL("CREATE INDEX IF NOT EXISTS index_context_memory_updatedAt ON context_memory (updatedAt)")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_context_memory_deletedAt ON context_memory (deletedAt)")

        db.execSQL(
            "CREATE TABLE IF NOT EXISTS chat_sessions (id TEXT NOT NULL, startedAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, endedAt INTEGER, entryId TEXT, messagesJson TEXT NOT NULL, promptType TEXT NOT NULL, deletedAt INTEGER, PRIMARY KEY(id))",
        )
        db.execSQL("CREATE INDEX IF NOT EXISTS index_chat_sessions_entryId ON chat_sessions (entryId)")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_chat_sessions_updatedAt ON chat_sessions (updatedAt)")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_chat_sessions_deletedAt ON chat_sessions (deletedAt)")

        db.execSQL(
            "CREATE TABLE IF NOT EXISTS rewards (id TEXT NOT NULL, type TEXT NOT NULL, earnedAt INTEGER NOT NULL, label TEXT NOT NULL, description TEXT NOT NULL, updatedAt INTEGER NOT NULL, deletedAt INTEGER, PRIMARY KEY(id))",
        )
        db.execSQL("CREATE INDEX IF NOT EXISTS index_rewards_type ON rewards (type)")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_rewards_earnedAt ON rewards (earnedAt)")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_rewards_updatedAt ON rewards (updatedAt)")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_rewards_deletedAt ON rewards (deletedAt)")

        db.execSQL(
            "CREATE TABLE IF NOT EXISTS moods (id TEXT NOT NULL, dateKey TEXT NOT NULL, mood INTEGER NOT NULL, entryId TEXT, updatedAt INTEGER NOT NULL, deletedAt INTEGER, PRIMARY KEY(id))",
        )
        db.execSQL("CREATE INDEX IF NOT EXISTS index_moods_dateKey ON moods (dateKey)")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_moods_entryId ON moods (entryId)")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_moods_updatedAt ON moods (updatedAt)")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_moods_deletedAt ON moods (deletedAt)")
    }
}
