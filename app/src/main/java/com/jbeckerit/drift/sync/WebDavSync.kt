package com.jbeckerit.drift.sync

import com.jbeckerit.drift.data.Entry
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
        .toString()

    fun decode(raw: String): SyncBundle {
        val root = JSONObject(raw)
        require(root.optInt("version", 0) == 2) { "This WebDAV file is not Drift Android sync data." }
        return SyncBundle(
            root.array("entries").map(::readEntry),
            root.array("tasks").map(::readTask),
            root.array("templates").map(::readTemplate),
        )
    }

    private fun entry(value: Entry) = JSONObject().apply {
        put("id", value.id); put("body", value.body); put("createdAt", value.createdAt); put("updatedAt", value.updatedAt)
        nullable("mood", value.mood); put("isDraft", value.isDraft); put("revision", value.revision)
        nullable("reflection", value.reflection); nullable("reflectionRevision", value.reflectionRevision); nullable("deletedAt", value.deletedAt)
    }
    private fun task(value: Task) = JSONObject().apply {
        put("id", value.id); put("text", value.text); put("kind", value.kind); put("dateKey", value.dateKey); put("done", value.done)
        nullable("doneAt", value.doneAt); nullable("templateId", value.templateId); nullable("slot", value.slot); nullable("weekKey", value.weekKey)
        nullable("dueDate", value.dueDate); put("createdAt", value.createdAt); put("updatedAt", value.updatedAt); nullable("deletedAt", value.deletedAt)
    }
    private fun template(value: TaskTemplate) = JSONObject().apply {
        put("id", value.id); put("text", value.text); put("kind", value.kind); put("slotsCsv", value.slotsCsv); nullable("weeklyTarget", value.weeklyTarget)
        put("active", value.active); put("createdAt", value.createdAt); put("updatedAt", value.updatedAt); nullable("deletedAt", value.deletedAt)
    }
    private fun JSONObject.nullable(name: String, value: Any?) { put(name, value ?: JSONObject.NULL) }

    private fun readEntry(o: JSONObject) = Entry(
        o.string("id"), o.string("body"), o.long("createdAt"), o.long("updatedAt"), o.intOrNull("mood"), o.optBoolean("isDraft", true),
        o.optLong("revision", 1), o.stringOrNull("reflection"), o.longOrNull("reflectionRevision"), o.longOrNull("deletedAt"),
    )
    private fun readTask(o: JSONObject) = Task(
        o.string("id"), o.string("text"), o.string("kind"), o.string("dateKey"), o.optBoolean("done"), o.longOrNull("doneAt"),
        o.stringOrNull("templateId"), o.stringOrNull("slot"), o.stringOrNull("weekKey"), o.stringOrNull("dueDate"),
        o.long("createdAt"), o.long("updatedAt"), o.longOrNull("deletedAt"),
    )
    private fun readTemplate(o: JSONObject) = TaskTemplate(
        o.string("id"), o.string("text"), o.string("kind"), o.optString("slotsCsv"), o.intOrNull("weeklyTarget"), o.optBoolean("active", true),
        o.long("createdAt"), o.long("updatedAt"), o.longOrNull("deletedAt"),
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
}
