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
    @Query("UPDATE entries SET taggingStatus=:status, taggingError=:error, updatedAt=:now WHERE id=:id AND revision=:revision AND deletedAt IS NULL")
    suspend fun setTaggingState(id: String, revision: Long, status: String?, error: String?, now: Long): Int

    @Query("SELECT * FROM task_templates WHERE active=1 AND deletedAt IS NULL ORDER BY sortOrder, createdAt")
    fun observeTemplates(): Flow<List<TaskTemplate>>
    @Query("SELECT * FROM task_templates WHERE active=1 AND deletedAt IS NULL AND kind=:kind")
    suspend fun templates(kind: String): List<TaskTemplate>
    @Query("SELECT * FROM task_templates WHERE id=:id AND active=1 AND deletedAt IS NULL") suspend fun template(id: String): TaskTemplate?
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
    @Query("UPDATE tasks SET deletedAt=:now, updatedAt=:now WHERE entryId=:entryId AND source='extracted' AND deletedAt IS NULL") suspend fun deleteExtractedTasks(entryId: String, now: Long)
    @Query("SELECT * FROM tasks WHERE entryId=:entryId AND source='extracted' AND text=:text AND deletedAt IS NULL LIMIT 1") suspend fun extractedTask(entryId: String, text: String): Task?
    @Query("SELECT * FROM tasks WHERE entryId=:entryId AND source='extracted' AND deletedAt IS NULL") suspend fun extractedTasksForEntry(entryId: String): List<Task>

    @Query("SELECT * FROM entry_tags WHERE entryId=:entryId AND deletedAt IS NULL") suspend fun entryTags(entryId: String): EntryTags?
    @Query("SELECT * FROM entry_tags WHERE deletedAt IS NULL ORDER BY taggedAt DESC LIMIT :limit") suspend fun recentEntryTags(limit: Int): List<EntryTags>
    @Upsert suspend fun upsertEntryTags(tags: EntryTags)
    @Query("UPDATE entry_tags SET deletedAt=:now, updatedAt=:now WHERE entryId=:entryId AND deletedAt IS NULL") suspend fun deleteEntryTags(entryId: String, now: Long)

    @Query("SELECT * FROM context_memory WHERE id=:id AND deletedAt IS NULL") suspend fun contextMemory(id: String): ContextMemory?
    @Upsert suspend fun upsertContextMemory(memory: ContextMemory)
    @Query("UPDATE context_memory SET deletedAt=:now, updatedAt=:now WHERE id=:id AND deletedAt IS NULL") suspend fun deleteContextMemory(id: String, now: Long)

    @Query("SELECT * FROM chat_sessions WHERE id=:id AND deletedAt IS NULL") suspend fun chatSession(id: String): ChatSession?
    @Query("SELECT * FROM chat_sessions WHERE entryId=:entryId AND deletedAt IS NULL") suspend fun chatSessionsForEntry(entryId: String): List<ChatSession>
    @Upsert suspend fun upsertChatSession(session: ChatSession)
    @Query("UPDATE chat_sessions SET deletedAt=:now, updatedAt=:now WHERE entryId=:entryId AND deletedAt IS NULL") suspend fun deleteChatSessionsForEntry(entryId: String, now: Long)

    @Query("SELECT * FROM rewards WHERE deletedAt IS NULL ORDER BY earnedAt DESC") fun observeRewards(): Flow<List<Reward>>
    @Query("SELECT * FROM rewards WHERE id=:id AND deletedAt IS NULL") suspend fun reward(id: String): Reward?
    @Upsert suspend fun upsertReward(reward: Reward)

    @Query("SELECT * FROM moods WHERE deletedAt IS NULL AND dateKey>=:since ORDER BY dateKey DESC") suspend fun moodsSince(since: String): List<MoodEntry>
    @Query("SELECT * FROM moods WHERE entryId=:entryId AND deletedAt IS NULL LIMIT 1") suspend fun moodForEntry(entryId: String): MoodEntry?
    @Upsert suspend fun upsertMood(mood: MoodEntry)
    @Query("UPDATE moods SET deletedAt=:now, updatedAt=:now WHERE entryId=:entryId AND deletedAt IS NULL") suspend fun deleteMoodForEntry(entryId: String, now: Long)

    @Query("SELECT * FROM entries") suspend fun syncEntries(): List<Entry>
    @Query("SELECT * FROM tasks") suspend fun syncTasks(): List<Task>
    @Query("SELECT * FROM task_templates") suspend fun syncTemplates(): List<TaskTemplate>
    @Query("SELECT * FROM entry_tags") suspend fun syncEntryTags(): List<EntryTags>
    @Query("SELECT * FROM context_memory") suspend fun syncContextMemory(): List<ContextMemory>
    @Query("SELECT * FROM chat_sessions") suspend fun syncChatSessions(): List<ChatSession>
    @Query("SELECT * FROM rewards") suspend fun syncRewards(): List<Reward>
    @Query("SELECT * FROM moods") suspend fun syncMoods(): List<MoodEntry>
    @Query("DELETE FROM entries") suspend fun clearEntries()
    @Query("DELETE FROM tasks") suspend fun clearTasks()
    @Query("DELETE FROM task_templates") suspend fun clearTemplates()
    @Query("DELETE FROM entry_tags") suspend fun clearEntryTags()
    @Query("DELETE FROM context_memory") suspend fun clearContextMemory()
    @Query("DELETE FROM chat_sessions") suspend fun clearChatSessions()
    @Query("DELETE FROM rewards") suspend fun clearRewards()
    @Query("DELETE FROM moods") suspend fun clearMoods()
}
