package com.jbeckerit.drift.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

@Dao
interface DriftDao {
    @Query("SELECT * FROM entries WHERE deletedAt IS NULL AND isDraft = 0 ORDER BY createdAt DESC")
    fun observeEntries(): Flow<List<Entry>>
    @Query("SELECT * FROM entries WHERE deletedAt IS NULL AND isDraft = 0 ORDER BY createdAt DESC LIMIT :limit")
    suspend fun recentEntries(limit: Int): List<Entry>
    @Query("SELECT * FROM entries WHERE deletedAt IS NULL AND isDraft = 1 ORDER BY updatedAt DESC LIMIT 1")
    suspend fun latestDraft(): Entry?
    @Query("SELECT * FROM entries WHERE id = :id AND deletedAt IS NULL")
    suspend fun entry(id: String): Entry?
    @Query("SELECT * FROM entries WHERE id = :id")
    suspend fun entryAny(id: String): Entry?
    @Upsert suspend fun upsertEntry(entry: Entry)
    @Upsert suspend fun upsertEntries(entries: List<Entry>)
    @Query("UPDATE entries SET deletedAt=:now, updatedAt=:now WHERE id=:id") suspend fun deleteEntry(id: String, now: Long)
    @Query("UPDATE entries SET reflection=:reflection, reflectionRevision=:revision, updatedAt=:now WHERE id=:id AND revision=:revision AND deletedAt IS NULL")
    suspend fun setReflection(id: String, revision: Long, reflection: String, now: Long): Int

    @Query("SELECT * FROM task_templates WHERE active=1 AND deletedAt IS NULL ORDER BY createdAt")
    fun observeTemplates(): Flow<List<TaskTemplate>>
    @Query("SELECT * FROM task_templates WHERE active=1 AND deletedAt IS NULL AND kind=:kind")
    suspend fun templates(kind: String): List<TaskTemplate>
    @Upsert suspend fun upsertTemplate(template: TaskTemplate)
    @Upsert suspend fun upsertTemplates(templates: List<TaskTemplate>)
    @Query("UPDATE task_templates SET active=0, deletedAt=:now, updatedAt=:now WHERE id=:id") suspend fun deleteTemplate(id: String, now: Long)

    @Query("SELECT * FROM tasks WHERE deletedAt IS NULL AND dateKey=:date AND weekKey IS NULL AND kind != 'TODO' ORDER BY done, createdAt")
    fun observeDaily(date: String): Flow<List<Task>>
    @Query("SELECT * FROM tasks WHERE deletedAt IS NULL AND dateKey=:date AND weekKey IS NULL AND kind != 'TODO' ORDER BY done, createdAt")
    suspend fun daily(date: String): List<Task>
    @Query("SELECT * FROM tasks WHERE deletedAt IS NULL AND weekKey=:week ORDER BY createdAt")
    fun observeWeekly(week: String): Flow<List<Task>>
    @Query("SELECT * FROM tasks WHERE deletedAt IS NULL AND weekKey=:week ORDER BY createdAt")
    suspend fun weekly(week: String): List<Task>
    @Query("SELECT * FROM tasks WHERE deletedAt IS NULL AND kind='TODO' ORDER BY done, dueDate, createdAt")
    fun observeTodos(): Flow<List<Task>>
    @Query("SELECT * FROM tasks WHERE id=:id AND deletedAt IS NULL") suspend fun task(id: String): Task?
    @Insert(onConflict = OnConflictStrategy.IGNORE) suspend fun insertIgnore(tasks: List<Task>): List<Long>
    @Upsert suspend fun upsertTask(task: Task)
    @Upsert suspend fun upsertTasks(tasks: List<Task>)
    @Query("UPDATE tasks SET done=:done, doneAt=:doneAt, updatedAt=:now WHERE id=:id AND deletedAt IS NULL") suspend fun setDone(id: String, done: Boolean, doneAt: Long?, now: Long)
    @Query("UPDATE tasks SET deletedAt=:now, updatedAt=:now WHERE id=:id") suspend fun deleteTask(id: String, now: Long)
    @Query("UPDATE tasks SET deletedAt=:now, updatedAt=:now WHERE templateId=:templateId AND deletedAt IS NULL") suspend fun deleteTemplateTasks(templateId: String, now: Long)

    @Query("SELECT * FROM entries") suspend fun syncEntries(): List<Entry>
    @Query("SELECT * FROM tasks") suspend fun syncTasks(): List<Task>
    @Query("SELECT * FROM task_templates") suspend fun syncTemplates(): List<TaskTemplate>
    @Query("DELETE FROM entries") suspend fun clearEntries()
    @Query("DELETE FROM tasks") suspend fun clearTasks()
    @Query("DELETE FROM task_templates") suspend fun clearTemplates()
}
