package com.jbeckerit.drift.data

import androidx.room.Entity
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
)

@Entity(tableName = "tasks", indices = [Index("dateKey"), Index("weekKey"), Index("templateId"), Index("deletedAt")])
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
)

object TaskKind {
    const val DAILY = "DAILY"
    const val WEEKLY = "WEEKLY"
    const val TODO = "TODO"
    const val CUSTOM = "CUSTOM"
}

object TemplateKind { const val DAILY = "DAILY"; const val WEEKLY = "WEEKLY" }
