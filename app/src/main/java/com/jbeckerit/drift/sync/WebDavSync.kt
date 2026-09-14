package com.jbeckerit.drift.sync

import com.jbeckerit.drift.data.Entry
import com.jbeckerit.drift.data.EntryTags
import com.jbeckerit.drift.data.ContextMemory
import com.jbeckerit.drift.data.ChatSession
import com.jbeckerit.drift.data.Reward
import com.jbeckerit.drift.data.MoodEntry
import com.jbeckerit.drift.data.DriftRepository
import com.jbeckerit.drift.data.SyncBundle
import com.jbeckerit.drift.data.SyncSettings
import com.jbeckerit.drift.data.Task
import com.jbeckerit.drift.data.TaskTemplate
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.Credentials
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

data class SyncResult(val entries: Int, val tasks: Int, val templates: Int)

/** A small, interoperable WebDAV file protocol. Credentials remain in Android Keystore-backed storage. */
class WebDavSync(private val repository: DriftRepository) {
    private val client = OkHttpClient.Builder().connectTimeout(20, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS).build()

    suspend fun sync(settings: SyncSettings): SyncResult = withContext(Dispatchers.IO) {
        require(settings.url.isNotBlank()) { "Add a WebDAV URL first." }
        require(settings.username.isNotBlank()) { "Add a WebDAV username first." }
        val endpoint = endpoint(settings.url)
        repeat(2) { attempt ->
            val local = repository.allForSync()
            val remote = fetch(endpoint, settings)
            val merged = remote?.let { SyncBundle.merge(local, it.bundle) } ?: local
            repository.merge(merged)
            when (put(endpoint, settings, merged, remote?.etag)) {
                PutResult.SAVED -> return@withContext SyncResult(merged.entries.size, merged.tasks.size, merged.templates.size)
                PutResult.CONFLICT -> if (attempt == 1) throw IOException("The remote file changed repeatedly. Try syncing again.")
            }
        }
        error("Unreachable")
    }

    private fun endpoint(raw: String): String {
        val cleaned = raw.trim().removeSuffix("/")
        require(cleaned.startsWith("https://") || cleaned.startsWith("http://")) { "Use a full http(s) WebDAV URL." }
        return if (cleaned.endsWith(".json", true)) cleaned else "$cleaned/drift-v2.json"
    }

    private fun auth(settings: SyncSettings) = Credentials.basic(settings.username, settings.password, Charsets.UTF_8)
    private fun fetch(url: String, settings: SyncSettings): Remote? {
        val request = Request.Builder().url(url).header("Authorization", auth(settings)).get().build()
        client.newCall(request).execute().use { response ->
            if (response.code == 404) return null
            if (!response.isSuccessful) throw IOException("WebDAV download failed (${response.code}).")
            val raw = response.body?.string().orEmpty()
            return Remote(JsonSync.decode(raw), response.header("ETag"))
        }
    }

    private fun put(url: String, settings: SyncSettings, bundle: SyncBundle, etag: String?): PutResult {
        val builder = Request.Builder().url(url).header("Authorization", auth(settings)).header("Content-Type", "application/json")
        if (etag != null) builder.header("If-Match", etag) else builder.header("If-None-Match", "*")
        val request = builder.put(JsonSync.encode(bundle).toRequestBody(JSON)).build()
        client.newCall(request).execute().use { response ->
            if (response.code == 412) return PutResult.CONFLICT
            if (!response.isSuccessful) throw IOException("WebDAV upload failed (${response.code}).")
            return PutResult.SAVED
        }
    }

    private data class Remote(val bundle: SyncBundle, val etag: String?)
    private enum class PutResult { SAVED, CONFLICT }
    private companion object { val JSON = "application/json; charset=utf-8".toMediaType() }
}

private object JsonSync {
    fun encode(bundle: SyncBundle): String = JSONObject()
        .put("version", 2)
        .put("entries", JSONArray(bundle.entries.map(::entry)))
        .put("tasks", JSONArray(bundle.tasks.map(::task)))
        .put("templates", JSONArray(bundle.templates.map(::template)))
        .put("entryTags", JSONArray(bundle.entryTags.map(::entryTags)))
        .put("contextMemory", JSONArray(bundle.contextMemory.map(::contextMemory)))
        .put("sessions", JSONArray(bundle.sessions.map(::session)))
        .put("rewards", JSONArray(bundle.rewards.map(::reward)))
        .put("moods", JSONArray(bundle.moods.map(::mood)))
        .toString()

    fun decode(raw: String): SyncBundle {
        val root = JSONObject(raw)
        require(root.optInt("version", 0) == 2) { "This WebDAV file is not Drift Android sync data." }
        return SyncBundle(
            root.array("entries").map(::readEntry),
            root.array("tasks").map(::readTask),
            root.array("templates").map(::readTemplate),
            root.array("entryTags").map(::readEntryTags),
            root.array("contextMemory").map(::readContextMemory),
            root.array("sessions").map(::readSession),
            root.array("rewards").map(::readReward),
            root.array("moods").map(::readMood),
        )
    }

    private fun entry(value: Entry) = JSONObject().apply {
        put("id", value.id); put("body", value.body); put("createdAt", value.createdAt); put("updatedAt", value.updatedAt)
        nullable("mood", value.mood); put("isDraft", value.isDraft); put("revision", value.revision)
        nullable("reflection", value.reflection); nullable("reflectionRevision", value.reflectionRevision); nullable("deletedAt", value.deletedAt)
        put("wordCount", value.wordCount); nullable("taggingStatus", value.taggingStatus); nullable("taggingError", value.taggingError)
    }
    private fun task(value: Task) = JSONObject().apply {
        put("id", value.id); put("text", value.text); put("kind", value.kind); put("dateKey", value.dateKey); put("done", value.done)
        nullable("doneAt", value.doneAt); nullable("templateId", value.templateId); nullable("slot", value.slot); nullable("weekKey", value.weekKey)
        nullable("dueDate", value.dueDate); put("createdAt", value.createdAt); put("updatedAt", value.updatedAt); nullable("deletedAt", value.deletedAt)
        put("source", value.source); nullable("entryId", value.entryId)
    }
    private fun template(value: TaskTemplate) = JSONObject().apply {
        put("id", value.id); put("text", value.text); put("kind", value.kind); put("slotsCsv", value.slotsCsv); nullable("weeklyTarget", value.weeklyTarget)
        put("active", value.active); put("createdAt", value.createdAt); put("updatedAt", value.updatedAt); nullable("deletedAt", value.deletedAt)
        put("sortOrder", value.sortOrder); put("slotOrdersJson", value.slotOrdersJson)
    }
    private fun entryTags(value: EntryTags) = JSONObject().apply {
        put("entryId", value.entryId); put("topicsJson", value.topicsJson); nullable("sleepHours", value.sleepHours)
        put("moodWordsJson", value.moodWordsJson); put("tasksOpenJson", value.tasksOpenJson); put("tasksDoneJson", value.tasksDoneJson)
        put("peopleJson", value.peopleJson); put("oneLineSummary", value.oneLineSummary); put("taggedAt", value.taggedAt)
        put("entryRevision", value.entryRevision); put("updatedAt", value.updatedAt); nullable("deletedAt", value.deletedAt)
    }
    private fun contextMemory(value: ContextMemory) = JSONObject().apply {
        put("id", value.id); put("patternsJson", value.patternsJson); put("keyFactsJson", value.keyFactsJson)
        put("openLoopsJson", value.openLoopsJson); put("recentWinsJson", value.recentWinsJson); put("moodTrend", value.moodTrend)
        put("lastUpdated", value.lastUpdated); put("entryCount", value.entryCount); put("updatedAt", value.updatedAt); nullable("deletedAt", value.deletedAt)
    }
    private fun session(value: ChatSession) = JSONObject().apply {
        put("id", value.id); put("startedAt", value.startedAt); put("updatedAt", value.updatedAt); nullable("endedAt", value.endedAt)
        nullable("entryId", value.entryId); put("messagesJson", value.messagesJson); put("promptType", value.promptType); nullable("deletedAt", value.deletedAt)
    }
    private fun reward(value: Reward) = JSONObject().apply {
        put("id", value.id); put("type", value.type); put("earnedAt", value.earnedAt); put("label", value.label); put("description", value.description)
        put("updatedAt", value.updatedAt); nullable("deletedAt", value.deletedAt)
    }
    private fun mood(value: MoodEntry) = JSONObject().apply {
        put("id", value.id); put("dateKey", value.dateKey); put("mood", value.mood); nullable("entryId", value.entryId)
        put("updatedAt", value.updatedAt); nullable("deletedAt", value.deletedAt)
    }
    private fun JSONObject.nullable(name: String, value: Any?) { put(name, value ?: JSONObject.NULL) }

    private fun readEntry(o: JSONObject) = Entry(
        id = o.string("id"), body = o.string("body"), createdAt = o.long("createdAt"), updatedAt = o.long("updatedAt"), mood = o.intOrNull("mood"), isDraft = o.optBoolean("isDraft", true),
        revision = o.optLong("revision", 1), reflection = o.stringOrNull("reflection"), reflectionRevision = o.longOrNull("reflectionRevision"), deletedAt = o.longOrNull("deletedAt"),
        wordCount = o.optInt("wordCount", o.optString("body").wordCount()), taggingStatus = o.stringOrNull("taggingStatus"), taggingError = o.stringOrNull("taggingError"),
    )
    private fun readTask(o: JSONObject) = Task(
        id = o.string("id"), text = o.string("text"), kind = o.string("kind"), dateKey = o.string("dateKey"), done = o.optBoolean("done"), doneAt = o.longOrNull("doneAt"),
        templateId = o.stringOrNull("templateId"), slot = o.stringOrNull("slot"), weekKey = o.stringOrNull("weekKey"), dueDate = o.stringOrNull("dueDate"),
        createdAt = o.long("createdAt"), updatedAt = o.long("updatedAt"), deletedAt = o.longOrNull("deletedAt"), source = o.optString("source", "manual"), entryId = o.stringOrNull("entryId"),
    )
    private fun readTemplate(o: JSONObject) = TaskTemplate(
        id = o.string("id"), text = o.string("text"), kind = o.string("kind"), slotsCsv = o.optString("slotsCsv"), weeklyTarget = o.intOrNull("weeklyTarget"), active = o.optBoolean("active", true),
        createdAt = o.long("createdAt"), updatedAt = o.long("updatedAt"), deletedAt = o.longOrNull("deletedAt"), sortOrder = o.optInt("sortOrder", 0), slotOrdersJson = o.optString("slotOrdersJson"),
    )
    private fun readEntryTags(o: JSONObject) = EntryTags(
        entryId = o.string("entryId"), topicsJson = o.optString("topicsJson", "[]"), sleepHours = o.doubleOrNull("sleepHours"),
        moodWordsJson = o.optString("moodWordsJson", "[]"), tasksOpenJson = o.optString("tasksOpenJson", "[]"), tasksDoneJson = o.optString("tasksDoneJson", "[]"),
        peopleJson = o.optString("peopleJson", "[]"), oneLineSummary = o.optString("oneLineSummary"), taggedAt = o.long("taggedAt"), entryRevision = o.optLong("entryRevision", 1),
        updatedAt = o.long("updatedAt"), deletedAt = o.longOrNull("deletedAt"),
    )
    private fun readContextMemory(o: JSONObject) = ContextMemory(
        id = o.string("id"), patternsJson = o.optString("patternsJson", "[]"), keyFactsJson = o.optString("keyFactsJson", "[]"),
        openLoopsJson = o.optString("openLoopsJson", "[]"), recentWinsJson = o.optString("recentWinsJson", "[]"), moodTrend = o.optString("moodTrend"),
        lastUpdated = o.long("lastUpdated"), entryCount = o.optInt("entryCount"), updatedAt = o.long("updatedAt"), deletedAt = o.longOrNull("deletedAt"),
    )
    private fun readSession(o: JSONObject) = ChatSession(
        id = o.string("id"), startedAt = o.long("startedAt"), updatedAt = o.long("updatedAt"), endedAt = o.longOrNull("endedAt"),
        entryId = o.stringOrNull("entryId"), messagesJson = o.optString("messagesJson", "[]"), promptType = o.string("promptType"), deletedAt = o.longOrNull("deletedAt"),
    )
    private fun readReward(o: JSONObject) = Reward(
        id = o.string("id"), type = o.string("type"), earnedAt = o.long("earnedAt"), label = o.string("label"), description = o.string("description"),
        updatedAt = o.long("updatedAt"), deletedAt = o.longOrNull("deletedAt"),
    )
    private fun readMood(o: JSONObject) = MoodEntry(
        id = o.string("id"), dateKey = o.string("dateKey"), mood = o.mood(), entryId = o.stringOrNull("entryId"),
        updatedAt = o.long("updatedAt"), deletedAt = o.longOrNull("deletedAt"),
    )
    private fun JSONObject.array(name: String): List<JSONObject> {
        val values = optJSONArray(name) ?: return emptyList()
        return (0 until values.length()).map(values::getJSONObject)
    }
    private fun JSONObject.string(name: String): String = getString(name)
    private fun JSONObject.long(name: String): Long = getLong(name)
    private fun JSONObject.stringOrNull(name: String): String? = if (isNull(name)) null else getString(name)
    private fun JSONObject.longOrNull(name: String): Long? = if (isNull(name)) null else getLong(name)
    private fun JSONObject.intOrNull(name: String): Int? = if (isNull(name)) null else getInt(name)
    private fun JSONObject.doubleOrNull(name: String): Double? = if (isNull(name)) null else getDouble(name).takeIf(Double::isFinite)
    private fun JSONObject.mood(): Int = optInt("mood").also { require(it in 1..5) { "This WebDAV file contains an invalid mood value." } }
    private fun String.wordCount(): Int = trim().split(Regex("\\s+")).count(String::isNotBlank)
}
