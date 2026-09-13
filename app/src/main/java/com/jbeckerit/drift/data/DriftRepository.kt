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
import java.time.LocalDate
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
            id, body, old?.createdAt ?: now, now, mood,
            isDraft = old?.isDraft ?: true,
            revision = if (editingSaved) (old?.revision ?: 0) + 1 else old?.revision ?: 1,
            reflection = if (editingSaved) null else old?.reflection,
            reflectionRevision = if (editingSaved) null else old?.reflectionRevision,
        )
        dao.upsertEntry(result); afterChange(); return result
    }

    suspend fun saveEntry(id: String, body: String, mood: Int?): Entry {
        require(body.isNotBlank()) { "An entry needs some text." }
        val old = dao.entryAny(id)
        val now = System.currentTimeMillis()
        val result = Entry(id, body.trimEnd(), old?.createdAt ?: now, now, mood, false, (old?.revision ?: 0) + 1)
        dao.upsertEntry(result); afterChange(); return result
    }

    suspend fun storeReflection(id: String, revision: Long, text: String): Boolean {
        val stored = dao.setReflection(id, revision, text.trim(), System.currentTimeMillis()) > 0
        if (stored) afterChange()
        return stored
    }

    suspend fun deleteEntry(id: String) { dao.deleteEntry(id, System.currentTimeMillis()); afterChange() }

    suspend fun createDaily(text: String, slots: List<String>) {
        val clean = slots.filter { it in TaskKeys.slots }.distinct()
        require(text.isNotBlank() && clean.isNotEmpty()) { "Add a task and at least one time of day." }
        val now = System.currentTimeMillis()
        val template = TaskTemplate(UUID.randomUUID().toString(), text.trim(), TemplateKind.DAILY, clean.joinToString(","), null, true, now, now)
        dao.upsertTemplate(template); ensureDaily(LocalDate.now()); afterChange()
    }

    suspend fun createWeekly(text: String, target: Int) {
        require(text.isNotBlank()) { "A weekly goal needs some text." }
        val now = System.currentTimeMillis()
        dao.upsertTemplate(TaskTemplate(UUID.randomUUID().toString(), text.trim(), TemplateKind.WEEKLY, weeklyTarget = target.coerceIn(1, 7), createdAt = now, updatedAt = now))
        ensureWeekly(LocalDate.now()); afterChange()
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

    suspend fun ensureCurrent() { ensureDaily(LocalDate.now()); ensureWeekly(LocalDate.now()) }
    suspend fun unfinishedToday(slot: String? = null): List<Task> {
        ensureCurrent()
        val date = TaskKeys.today()
        return dao.daily(date).filter { !it.done && (slot == null || it.slot == slot) }
    }
    suspend fun unfinishedTodos(): List<Task> = dao.observeTodos().first().filterNot { it.done }
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

    suspend fun allForSync() = SyncBundle(dao.syncEntries(), dao.syncTasks(), dao.syncTemplates())
    suspend fun merge(bundle: SyncBundle) {
        val local = allForSync(); val merged = SyncBundle.merge(local, bundle)
        database.withTransaction { dao.upsertEntries(merged.entries); dao.upsertTasks(merged.tasks); dao.upsertTemplates(merged.templates) }
    }
    suspend fun clear() { database.withTransaction { dao.clearEntries(); dao.clearTasks(); dao.clearTemplates() } }

    private fun localDates(): Flow<LocalDate> = flow {
        while (currentCoroutineContext().isActive) { val now = ZonedDateTime.now(); emit(now.toLocalDate()); delay(TaskKeys.toNextDate(now)) }
    }.distinctUntilChanged()
}

data class SyncBundle(val entries: List<Entry> = emptyList(), val tasks: List<Task> = emptyList(), val templates: List<TaskTemplate> = emptyList()) {
    companion object {
        fun merge(local: SyncBundle, remote: SyncBundle) = SyncBundle(
            choose(local.entries, remote.entries, { it.id }) { maxOf(it.updatedAt, it.deletedAt ?: 0) },
            choose(local.tasks, remote.tasks, { it.id }) { maxOf(it.updatedAt, it.deletedAt ?: 0) },
            choose(local.templates, remote.templates, { it.id }) { maxOf(it.updatedAt, it.deletedAt ?: 0) },
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
