package com.jbeckerit.drift.data

import androidx.room.Entity
import androidx.room.ColumnInfo
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(tableName = "entries", indices = [Index("createdAt"), Index("updatedAt"), Index("deletedAt")])
data class Entry(
    @PrimaryKey val id: String,
    val body: String,
    val createdAt: Long,
    val updatedAt: Long,
    val mood: Int? = null,
    val isDraft: Boolean = true,
    val revision: Long = 1,
    val reflection: String? = null,
    val reflectionRevision: Long? = null,
    val deletedAt: Long? = null,
    @ColumnInfo(defaultValue = "0") val wordCount: Int = 0,
    val taggingStatus: String? = null,
    val taggingError: String? = null,
)

@Entity(tableName = "task_templates", indices = [Index("kind"), Index("active"), Index("updatedAt")])
data class TaskTemplate(
    @PrimaryKey val id: String,
    val text: String,
    val kind: String,
    val slotsCsv: String = "",
    val weeklyTarget: Int? = null,
    val active: Boolean = true,
    val createdAt: Long,
    val updatedAt: Long,
    val deletedAt: Long? = null,
    @ColumnInfo(defaultValue = "0") val sortOrder: Int = 0,
    @ColumnInfo(defaultValue = "''") val slotOrdersJson: String = "",
)

@Entity(tableName = "tasks", indices = [Index("dateKey"), Index("weekKey"), Index("templateId"), Index("entryId"), Index("deletedAt")])
data class Task(
    @PrimaryKey val id: String,
    val text: String,
    val kind: String,
    val dateKey: String,
    val done: Boolean = false,
    val doneAt: Long? = null,
    val templateId: String? = null,
    val slot: String? = null,
    val weekKey: String? = null,
    val dueDate: String? = null,
    val createdAt: Long,
    val updatedAt: Long,
    val deletedAt: Long? = null,
    @ColumnInfo(defaultValue = "'manual'") val source: String = TaskSource.MANUAL,
    val entryId: String? = null,
)

object TaskKind {
    const val DAILY = "DAILY"
    const val WEEKLY = "WEEKLY"
    const val TODO = "TODO"
    const val CUSTOM = "CUSTOM"
}

object TemplateKind { const val DAILY = "DAILY"; const val WEEKLY = "WEEKLY" }

object TaskSource {
    const val MANUAL = "manual"
    const val EXTRACTED = "extracted"
}

/** Structured details extracted from an entry. JSON columns keep the Room schema portable. */
@Entity(tableName = "entry_tags", indices = [Index("updatedAt"), Index("deletedAt")])
data class EntryTags(
    @PrimaryKey val entryId: String,
    val topicsJson: String,
    val sleepHours: Double? = null,
    val moodWordsJson: String,
    val tasksOpenJson: String,
    val tasksDoneJson: String,
    val peopleJson: String,
    val oneLineSummary: String,
    val taggedAt: Long,
    val entryRevision: Long,
    val updatedAt: Long,
    val deletedAt: Long? = null,
)

/** A single, rolling set of user-approved journal context for richer reflections. */
@Entity(tableName = "context_memory", indices = [Index("updatedAt"), Index("deletedAt")])
data class ContextMemory(
    @PrimaryKey val id: String = PRIMARY_ID,
    val patternsJson: String,
    val keyFactsJson: String,
    val openLoopsJson: String,
    val recentWinsJson: String,
    val moodTrend: String,
    val lastUpdated: Long,
    val entryCount: Int,
    val updatedAt: Long,
    val deletedAt: Long? = null,
) {
    companion object { const val PRIMARY_ID = "primary" }
}

@Entity(tableName = "chat_sessions", indices = [Index("entryId"), Index("updatedAt"), Index("deletedAt")])
data class ChatSession(
    @PrimaryKey val id: String,
    val startedAt: Long,
    val updatedAt: Long,
    val endedAt: Long? = null,
    val entryId: String? = null,
    val messagesJson: String,
    val promptType: String,
    val deletedAt: Long? = null,
)

data class StoredChatMessage(val role: String, val content: String, val timestamp: Long)

@Entity(tableName = "rewards", indices = [Index("type"), Index("earnedAt"), Index("updatedAt"), Index("deletedAt")])
data class Reward(
    @PrimaryKey val id: String,
    val type: String,
    val earnedAt: Long,
    val label: String,
    val description: String,
    val updatedAt: Long,
    val deletedAt: Long? = null,
)

@Entity(tableName = "moods", indices = [Index("dateKey"), Index("entryId"), Index("updatedAt"), Index("deletedAt")])
data class MoodEntry(
    @PrimaryKey val id: String,
    val dateKey: String,
    val mood: Int,
    val entryId: String? = null,
    val updatedAt: Long,
    val deletedAt: Long? = null,
)
