package com.jbeckerit.drift.data

import androidx.room.withTransaction
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.isActive
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime
import java.util.UUID

@OptIn(ExperimentalCoroutinesApi::class)
class DriftRepository(private val database: DriftDatabase, private val afterChange: () -> Unit = {}) {
    private val dao = database.dao()

    fun observeEntries(): Flow<List<Entry>> = dao.observeEntries()
    fun observeTemplates(): Flow<List<TaskTemplate>> = dao.observeTemplates()
    fun observeTodos(): Flow<List<Task>> = dao.observeTodos()
    fun observeToday(): Flow<List<Task>> = localDates().onEach(::ensureDaily).flatMapLatest { dao.observeDaily(it.toString()) }
    fun observeWeekly(): Flow<List<Task>> = localDates().onEach(::ensureWeekly).flatMapLatest { dao.observeWeekly(TaskKeys.week(it)) }
    suspend fun recentEntries(limit: Int = 8) = dao.recentEntries(limit)
    suspend fun latestDraft() = dao.latestDraft()
    suspend fun entry(id: String) = dao.entry(id)

    suspend fun saveDraft(id: String, body: String, mood: Int?): Entry {
        val old = dao.entryAny(id)
        val now = System.currentTimeMillis()
        val editingSaved = old?.isDraft == false
        val result = Entry(
            id = id,
            body = body,
            createdAt = old?.createdAt ?: now,
            updatedAt = now,
            mood = mood,
            isDraft = old?.isDraft ?: true,
            revision = if (editingSaved) (old?.revision ?: 0) + 1 else old?.revision ?: 1,
            reflection = if (editingSaved) null else old?.reflection,
            reflectionRevision = if (editingSaved) null else old?.reflectionRevision,
            wordCount = body.wordCount(),
            taggingStatus = if (editingSaved) null else old?.taggingStatus,
            taggingError = if (editingSaved) null else old?.taggingError,
        )
        database.withTransaction {
            dao.upsertEntry(result)
            if (editingSaved) {
                if (mood == null) {
                    dao.deleteMoodForEntry(id, now)
                } else {
                    dao.upsertMood(MoodEntry("mood:$id", result.createdAt.localDateKey(), mood, id, now))
                }
            }
        }
        afterChange()
        return result
    }

    suspend fun saveEntry(id: String, body: String, mood: Int?): Entry {
        require(body.isNotBlank()) { "An entry needs some text." }
        val old = dao.entryAny(id)
        val now = System.currentTimeMillis()
        val cleanBody = body.trimEnd()
        val changed = old == null || old.isDraft || old.body != cleanBody || old.mood != mood
        val result = Entry(
            id = id,
            body = cleanBody,
            createdAt = old?.createdAt ?: now,
            updatedAt = now,
            mood = mood,
            isDraft = false,
            revision = if (changed) (old?.revision ?: 0) + 1 else old?.revision ?: 1,
            reflection = if (changed) null else old?.reflection,
            reflectionRevision = if (changed) null else old?.reflectionRevision,
            wordCount = cleanBody.wordCount(),
            taggingStatus = if (changed) null else old?.taggingStatus,
            taggingError = if (changed) null else old?.taggingError,
        )
        database.withTransaction {
            dao.upsertEntry(result)
            if (mood == null) {
                dao.deleteMoodForEntry(id, now)
            } else {
                dao.upsertMood(MoodEntry("mood:$id", result.createdAt.localDateKey(), mood, id, now))
            }
        }
        afterChange()
        if (changed) awardEntryMilestones(result)
        return result
    }

    suspend fun storeReflection(id: String, revision: Long, text: String): Boolean {
        val stored = dao.setReflection(id, revision, text.trim(), System.currentTimeMillis()) > 0
        if (stored) afterChange()
        return stored
    }

    suspend fun deleteEntry(id: String) {
        val now = System.currentTimeMillis()
        database.withTransaction {
            dao.deleteEntry(id, now)
            dao.deleteEntryTags(id, now)
            dao.deleteExtractedTasks(id, now)
            dao.deleteMoodForEntry(id, now)
            dao.deleteChatSessionsForEntry(id, now)
        }
        afterChange()
    }

    /** Returns insight only when it still describes the entry's current revision. */
    suspend fun entryTags(id: String): EntryTags? {
        val tags = dao.entryTags(id) ?: return null
        return tags.takeIf { dao.entry(id)?.revision == it.entryRevision }
    }
    suspend fun recentEntryTags(limit: Int = 14) = dao.recentEntryTags(limit)
    suspend fun entryTagCountSince(since: Long): Int = dao.entryTagCountSince(since)
    suspend fun taggingPending(id: String, revision: Long): Boolean =
        (dao.setTaggingState(id, revision, "pending", null, System.currentTimeMillis()) > 0).also { if (it) afterChange() }

    suspend fun taggingFailed(id: String, revision: Long, reason: String): Boolean =
        (dao.setTaggingState(id, revision, "failed", reason.take(240), System.currentTimeMillis()) > 0).also { if (it) afterChange() }

    /**
     * Stores a revision-bound analysis and reconciles its extracted tasks.
     *
     * Existing extracted tasks remain available while a re-analysis is running.
     * Once a new analysis succeeds, stale tasks are removed and a task the user
     * already completed stays complete even if the model reports it as open.
     */
    suspend fun storeEntryTags(id: String, revision: Long, data: EntryTagData): Boolean {
        val now = System.currentTimeMillis()
        val stored = database.withTransaction {
            val entry = dao.entry(id) ?: return@withTransaction false
            if (entry.revision != revision) return@withTransaction false
            val clean = data.cleaned()
            val existingTasks = dao.extractedTasksForEntry(id)
            val desired = linkedMapOf<String, Boolean>()
            clean.mentions.tasksOpen.forEach { desired[it] = false }
            clean.mentions.tasksDone.forEach { desired[it] = true }
            dao.upsertEntryTags(
                EntryTags(
                    entryId = id,
                    topicsJson = clean.topics.toJsonList(),
                    sleepHours = clean.mentions.sleepHours,
                    moodWordsJson = clean.mentions.moodWords.toJsonList(),
                    tasksOpenJson = clean.mentions.tasksOpen.toJsonList(),
                    tasksDoneJson = clean.mentions.tasksDone.toJsonList(),
                    peopleJson = clean.mentions.people.toJsonList(),
                    oneLineSummary = clean.oneLineSummary,
                    taggedAt = now,
                    entryRevision = revision,
                    updatedAt = now,
                ),
            )
            existingTasks
                .filter { it.text !in desired }
                .forEach { dao.deleteTask(it.id, now) }
            for ((taskText, reportedDone) in desired) {
                val existing = existingTasks.firstOrNull { it.text == taskText }
                if (existing == null) {
                    dao.upsertTask(
                        Task(
                            id = UUID.randomUUID().toString(),
                            text = taskText,
                            kind = TaskKind.TODO,
                            dateKey = TaskKeys.today(),
                            done = reportedDone,
                            doneAt = if (reportedDone) entry.createdAt else null,
                            createdAt = now,
                            updatedAt = now,
                            source = TaskSource.EXTRACTED,
                            entryId = id,
                        ),
                    )
                } else if (reportedDone && !existing.done) {
                    dao.upsertTask(existing.copy(done = true, doneAt = existing.doneAt ?: entry.createdAt, updatedAt = now))
                }
            }
            dao.setTaggingState(id, revision, "complete", null, now) > 0
        }
        if (stored) {
            afterChange()
            awardReward("insight", "First pattern", "You paused long enough to notice a thread in your own words.")
        }
        return stored
    }

    suspend fun contextMemory() = dao.contextMemory(ContextMemory.PRIMARY_ID)
    suspend fun saveContextMemory(memory: ContextMemory) {
        dao.upsertContextMemory(memory)
        afterChange()
    }
    suspend fun chatSession(id: String) = dao.chatSession(id)
    suspend fun createChatSession(promptType: String = "coach", entryId: String? = null): ChatSession {
        val now = System.currentTimeMillis()
        val session = ChatSession(
            id = UUID.randomUUID().toString(),
            startedAt = now,
            updatedAt = now,
            entryId = entryId,
            messagesJson = "[]",
            promptType = promptType,
        )
        dao.upsertChatSession(session)
        afterChange()
        return session
    }
    suspend fun appendChatMessage(sessionId: String, role: String, content: String): Boolean {
        require(role == "user" || role == "assistant") { "Chat messages need a valid role." }
        val clean = content.trim()
        if (clean.isBlank()) return false
        val now = System.currentTimeMillis()
        val updated = database.withTransaction {
            val session = dao.chatSession(sessionId) ?: return@withTransaction false
            val messages = session.messagesJson.toStoredChatMessages() + StoredChatMessage(role, clean, now)
            dao.upsertChatSession(session.copy(messagesJson = messages.toMessagesJson(), updatedAt = now))
            true
        }
        if (updated) afterChange()
        return updated
    }
    suspend fun endChatSession(sessionId: String): Boolean {
        val now = System.currentTimeMillis()
        val updated = database.withTransaction {
            val session = dao.chatSession(sessionId) ?: return@withTransaction false
            dao.upsertChatSession(session.copy(endedAt = now, updatedAt = now))
            true
        }
        if (updated) afterChange()
        return updated
    }
    suspend fun recentTaggedSummaries(limit: Int = 14): List<String> {
        val result = mutableListOf<String>()
        for (tags in dao.recentEntryTags(limit)) {
            val entry = dao.entry(tags.entryId) ?: continue
            if (entry.revision != tags.entryRevision) continue
            result += "[${entry.createdAt.localDateKey()}] ${tags.oneLineSummary}".trimEnd()
        }
        return result
    }
    suspend fun recentEntriesForContext(limit: Int = 5): List<Entry> = dao.recentEntries(limit)

    suspend fun taskNudgeSummary(): String {
        ensureCurrent()
        val today = TaskKeys.today()
        val parts = mutableListOf<String>()
        val undone = dao.daily(today).filterNot(Task::done)
        if (undone.isNotEmpty()) parts += "Undone today: ${undone.take(4).joinToString(", ") { it.text }}"
        val todos = dao.observeTodos().first().filterNot(Task::done)
        val overdue = todos.filter { it.dueDate != null && it.dueDate < today }
        val dueToday = todos.filter { it.dueDate == today }
        if (overdue.isNotEmpty()) parts += "Overdue to-dos: ${overdue.take(3).joinToString(", ") { "${it.text} (due ${it.dueDate})" }}"
        if (dueToday.isNotEmpty()) parts += "Due today: ${dueToday.take(3).joinToString(", ") { it.text }}"
        val weekly = dao.weekly(TaskKeys.week(LocalDate.now()))
        val templates = dao.templates(TemplateKind.WEEKLY).associateBy(TaskTemplate::id)
        weekly.groupBy { it.templateId }.forEach { (templateId, tasks) ->
            val template = templateId?.let(templates::get) ?: return@forEach
            val target = (template.weeklyTarget ?: 1).coerceIn(1, 7)
            val remaining = target - tasks.count(Task::done)
            if (remaining > 0 && LocalDate.now().dayOfWeek.value >= 4) {
                parts += "Weekly task nearing its end: ${template.text} needs $remaining more ${if (remaining == 1) "completion" else "completions"}."
            }
        }
        return parts.joinToString("\n")
    }
    suspend fun todayTasksSummary(): String {
        ensureCurrent()
        val tasks = dao.daily(TaskKeys.today())
        if (tasks.isEmpty()) return ""
        val open = tasks.filterNot(Task::done).map { "○ ${it.text}" }
        val done = tasks.filter(Task::done).map { "✓ ${it.text}" }
        return (open + done).joinToString("\n")
    }
    fun observeRewards(): Flow<List<Reward>> = dao.observeRewards()
    suspend fun awardReward(type: String, label: String, description: String): Reward? {
        val now = System.currentTimeMillis()
        val awarded = database.withTransaction {
            if (dao.reward(type) != null) {
                null
            } else {
                val reward = Reward(type, type, now, label, description, now)
                dao.upsertReward(reward)
                reward
            }
        }
        if (awarded != null) afterChange()
        return awarded
    }

    private suspend fun awardEntryMilestones(entry: Entry) {
        val entries = dao.syncEntries().filter { it.deletedAt == null && !it.isDraft }
        val dates = entries.map { it.createdAt.localDateKey() }.map(LocalDate::parse)
        val streak = GentleStreaks.calculate(dates)
        if (entries.size == 1) awardReward("first_entry", "First entry", "You made a place for one honest thought.")
        if (entry.wordCount >= 500) awardReward("deepthought", "A full thought", "You stayed with a thought long enough to give it some room.")
        if (entries.sumOf(Entry::wordCount) >= 1_000) awardReward("wordcount", "A thousand words", "Your notes are becoming a record you can come back to.")
        if (streak.current >= 3) awardReward("consistency", "A gentle rhythm", "You returned to your journal across a few days.")
        if (streak.current >= 7) awardReward("streak", "A week in motion", "A missed day never erased this; you kept finding your way back.")
    }

    suspend fun createDaily(text: String, slots: List<String>) {
        val clean = slots.filter { it in TaskKeys.slots }.distinct()
        require(text.isNotBlank() && clean.isNotEmpty()) { "Add a task and at least one time of day." }
        val now = System.currentTimeMillis()
        database.withTransaction {
            val nextOrder = (dao.templates(TemplateKind.DAILY).maxOfOrNull(TaskTemplate::sortOrder) ?: -1) + 1
            dao.upsertTemplate(
                TaskTemplate(
                    id = UUID.randomUUID().toString(),
                    text = text.trim(),
                    kind = TemplateKind.DAILY,
                    slotsCsv = clean.joinToString(","),
                    active = true,
                    createdAt = now,
                    updatedAt = now,
                    sortOrder = nextOrder,
                ),
            )
        }
        ensureDaily(LocalDate.now())
        afterChange()
    }

    suspend fun createWeekly(text: String, target: Int) {
        require(text.isNotBlank()) { "A weekly goal needs some text." }
        val now = System.currentTimeMillis()
        database.withTransaction {
            val nextOrder = (dao.templates(TemplateKind.WEEKLY).maxOfOrNull(TaskTemplate::sortOrder) ?: -1) + 1
            dao.upsertTemplate(
                TaskTemplate(
                    id = UUID.randomUUID().toString(),
                    text = text.trim(),
                    kind = TemplateKind.WEEKLY,
                    weeklyTarget = target.coerceIn(1, 7),
                    createdAt = now,
                    updatedAt = now,
                    sortOrder = nextOrder,
                ),
            )
        }
        ensureWeekly(LocalDate.now())
        afterChange()
    }

    suspend fun createOneOff(text: String, todo: Boolean, dueDate: String? = null) {
        require(text.isNotBlank()) { "A task needs some text." }
        val now = System.currentTimeMillis()
        dao.upsertTask(Task(UUID.randomUUID().toString(), text.trim(), if (todo) TaskKind.TODO else TaskKind.CUSTOM, TaskKeys.today(), dueDate = dueDate, createdAt = now, updatedAt = now))
        afterChange()
    }

    suspend fun toggleTask(id: String) {
        val task = dao.task(id) ?: return
        val now = System.currentTimeMillis(); dao.setDone(id, !task.done, if (task.done) null else now, now); afterChange()
    }
    suspend fun deleteTask(id: String) { dao.deleteTask(id, System.currentTimeMillis()); afterChange() }
    suspend fun deleteTemplate(id: String) {
        val now = System.currentTimeMillis()
        database.withTransaction { dao.deleteTemplate(id, now); dao.deleteTemplateTasks(id, now) }
        afterChange()
    }
    suspend fun moveRoutine(id: String, direction: Int) {
        require(direction == -1 || direction == 1) { "A routine can only move one place at a time." }
        val moved = database.withTransaction {
            val template = dao.template(id) ?: return@withTransaction false
            val siblings = dao.templates(template.kind)
                .sortedWith(compareBy<TaskTemplate> { it.sortOrder }.thenBy { it.createdAt })
            val index = siblings.indexOfFirst { it.id == id }
            val target = index + direction
            if (index !in siblings.indices || target !in siblings.indices) return@withTransaction false
            val now = System.currentTimeMillis()
            val reordered = siblings.toMutableList()
            val movedTemplate = reordered.removeAt(index)
            reordered.add(target, movedTemplate)
            reordered.forEachIndexed { order, item ->
                dao.upsertTemplate(item.copy(sortOrder = order, updatedAt = now))
            }
            true
        }
        if (moved) afterChange()
    }

    suspend fun ensureCurrent() { ensureDaily(LocalDate.now()); ensureWeekly(LocalDate.now()) }
    suspend fun unfinishedToday(slot: String? = null): List<Task> {
        ensureCurrent()
        val date = TaskKeys.today()
        return dao.daily(date).filter { !it.done && (slot == null || it.slot == slot) }
    }
    suspend fun unfinishedTodos(): List<Task> = dao.observeTodos().first().filterNot { it.done }
    suspend fun dueTodos(): List<Task> {
        val today = TaskKeys.today()
        return dao.observeTodos().first().filter { !it.done && it.dueDate != null && it.dueDate <= today }
    }
    suspend fun hasEntryToday(): Boolean {
        val start = LocalDate.now().atStartOfDay(java.time.ZoneId.systemDefault()).toInstant().toEpochMilli()
        return dao.recentEntries(50).any { it.createdAt >= start }
    }

    suspend fun ensureDaily(date: LocalDate) {
        val templates = dao.templates(TemplateKind.DAILY); if (templates.isEmpty()) return
        val key = date.toString(); val now = System.currentTimeMillis()
        val rows = templates.flatMap { template -> template.slotsCsv.split(',').filter { it in TaskKeys.slots }.map { slot ->
            Task(TaskKeys.dailyId(template.id, key, slot), template.text, TaskKind.DAILY, key, templateId = template.id, slot = slot, createdAt = now, updatedAt = now)
        } }
        if (database.withTransaction { dao.insertIgnore(rows).any { it != -1L } }) afterChange()
    }

    suspend fun ensureWeekly(date: LocalDate) {
        val templates = dao.templates(TemplateKind.WEEKLY); if (templates.isEmpty()) return
        val week = TaskKeys.week(date); val now = System.currentTimeMillis(); var changed = false
        database.withTransaction {
            templates.forEach { template ->
                val target = (template.weeklyTarget ?: 1).coerceIn(1, 7)
                val existing = dao.weekly(week).filter { it.templateId == template.id }
                val missing = (existing.size until target).map { n -> Task(TaskKeys.weeklyId(template.id, week, n), template.text, TaskKind.WEEKLY, date.toString(), templateId = template.id, weekKey = week, createdAt = now, updatedAt = now) }
                if (dao.insertIgnore(missing).any { it != -1L }) changed = true
                val keepUndone = (target - existing.count { it.done }).coerceAtLeast(0)
                existing.filterNot { it.done }.drop(keepUndone).forEach { dao.deleteTask(it.id, now); changed = true }
            }
        }
        if (changed) afterChange()
    }

    suspend fun allForSync() = database.withTransaction {
        SyncBundle(
            entries = dao.syncEntries(),
            tasks = dao.syncTasks(),
            templates = dao.syncTemplates(),
            entryTags = dao.syncEntryTags(),
            contextMemory = dao.syncContextMemory(),
            sessions = dao.syncChatSessions(),
            rewards = dao.syncRewards(),
            moods = dao.syncMoods(),
        )
    }
    suspend fun merge(bundle: SyncBundle) {
        val local = allForSync(); val merged = SyncBundle.merge(local, bundle)
        database.withTransaction {
            dao.upsertEntries(merged.entries)
            dao.upsertTasks(merged.tasks)
            dao.upsertTemplates(merged.templates)
            for (item in merged.entryTags) dao.upsertEntryTags(item)
            for (item in merged.contextMemory) dao.upsertContextMemory(item)
            for (item in merged.sessions) dao.upsertChatSession(item)
            for (item in merged.rewards) dao.upsertReward(item)
            for (item in merged.moods) dao.upsertMood(item)
        }
    }
    suspend fun replaceAllFromBackup(bundle: SyncBundle, scheduleSync: Boolean = true) {
        database.withTransaction {
            dao.clearEntries()
            dao.clearTasks()
            dao.clearTemplates()
            dao.clearEntryTags()
            dao.clearContextMemory()
            dao.clearChatSessions()
            dao.clearRewards()
            dao.clearMoods()
            if (bundle.entries.isNotEmpty()) dao.upsertEntries(bundle.entries)
            if (bundle.tasks.isNotEmpty()) dao.upsertTasks(bundle.tasks)
            if (bundle.templates.isNotEmpty()) dao.upsertTemplates(bundle.templates)
            for (item in bundle.entryTags) dao.upsertEntryTags(item)
            for (item in bundle.contextMemory) dao.upsertContextMemory(item)
            for (item in bundle.sessions) dao.upsertChatSession(item)
            for (item in bundle.rewards) dao.upsertReward(item)
            for (item in bundle.moods) dao.upsertMood(item)
        }
        if (scheduleSync) afterChange()
    }

    suspend fun clear() {
        database.withTransaction {
            dao.clearEntries(); dao.clearTasks(); dao.clearTemplates(); dao.clearEntryTags(); dao.clearContextMemory(); dao.clearChatSessions(); dao.clearRewards(); dao.clearMoods()
        }
    }

    private fun localDates(): Flow<LocalDate> = flow {
        while (currentCoroutineContext().isActive) { val now = ZonedDateTime.now(); emit(now.toLocalDate()); delay(TaskKeys.toNextDate(now)) }
    }.distinctUntilChanged()
}

data class SyncBundle(
    val entries: List<Entry> = emptyList(),
    val tasks: List<Task> = emptyList(),
    val templates: List<TaskTemplate> = emptyList(),
    val entryTags: List<EntryTags> = emptyList(),
    val contextMemory: List<ContextMemory> = emptyList(),
    val sessions: List<ChatSession> = emptyList(),
    val rewards: List<Reward> = emptyList(),
    val moods: List<MoodEntry> = emptyList(),
) {
    companion object {
        fun merge(local: SyncBundle, remote: SyncBundle) = SyncBundle(
            choose(local.entries, remote.entries, { it.id }) { maxOf(it.updatedAt, it.deletedAt ?: 0) },
            choose(local.tasks, remote.tasks, { it.id }) { maxOf(it.updatedAt, it.deletedAt ?: 0) },
            choose(local.templates, remote.templates, { it.id }) { maxOf(it.updatedAt, it.deletedAt ?: 0) },
            choose(local.entryTags, remote.entryTags, { it.entryId }) { maxOf(it.updatedAt, it.deletedAt ?: 0) },
            choose(local.contextMemory, remote.contextMemory, { it.id }) { maxOf(it.updatedAt, it.deletedAt ?: 0) },
            choose(local.sessions, remote.sessions, { it.id }) { maxOf(it.updatedAt, it.deletedAt ?: 0) },
            choose(local.rewards, remote.rewards, { it.id }) { maxOf(it.updatedAt, it.deletedAt ?: 0) },
            choose(local.moods, remote.moods, { it.id }) { maxOf(it.updatedAt, it.deletedAt ?: 0) },
        )
        private fun <T> choose(left: List<T>, right: List<T>, id: (T) -> String, time: (T) -> Long): List<T> {
            val local = left.associateBy(id)
            val remote = right.associateBy(id)
            return (local.keys + remote.keys).sorted().map { key ->
                val a = local[key]
                val b = remote[key]
                when {
                    a == null -> b!!
                    b == null -> a
                    time(b) > time(a) -> b
                    else -> a
                }
            }
        }
    }
}

private fun String.wordCount(): Int = trim().split(Regex("\\s+")).count(String::isNotBlank)

private fun Long.localDateKey(): String = Instant.ofEpochMilli(this).atZone(ZoneId.systemDefault()).toLocalDate().toString()

private fun EntryTagData.cleaned(): EntryTagData {
    fun clean(values: List<String>, limit: Int) = values.map { it.trim() }.filter(String::isNotBlank).distinct().take(limit)
    return copy(
        topics = clean(topics.map { it.lowercase() }, 5),
        mentions = mentions.copy(
            sleepHours = mentions.sleepHours?.takeIf { it in 0.0..24.0 },
            moodWords = clean(mentions.moodWords, 12),
            tasksOpen = clean(mentions.tasksOpen, 12),
            tasksDone = clean(mentions.tasksDone, 12),
            people = clean(mentions.people, 12),
        ),
        oneLineSummary = oneLineSummary.trim().take(240),
    )
}
