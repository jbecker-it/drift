package com.jbeckerit.drift.backup

import android.content.Context
import com.jbeckerit.drift.data.AiSettings
import com.jbeckerit.drift.data.BackupSettings
import com.jbeckerit.drift.data.ChatSession
import com.jbeckerit.drift.data.ContextMemory
import com.jbeckerit.drift.data.DriftRepository
import com.jbeckerit.drift.data.Entry
import com.jbeckerit.drift.data.EntryTags
import com.jbeckerit.drift.data.MoodEntry
import com.jbeckerit.drift.data.ReminderSettings
import com.jbeckerit.drift.data.Reward
import com.jbeckerit.drift.data.SecureSettings
import com.jbeckerit.drift.data.SyncBundle
import com.jbeckerit.drift.data.SyncSettings
import com.jbeckerit.drift.data.Task
import com.jbeckerit.drift.data.TaskTemplate
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.nio.ByteBuffer
import java.nio.charset.StandardCharsets
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

private const val BACKUP_VERSION = 2
private const val PBKDF2_ITERATIONS = 310_000
private const val KEY_BITS = 256
private const val SALT_BYTES = 16
private const val IV_BYTES = 12
private const val MAX_ARCHIVE_BYTES = 64 * 1024 * 1024
private const val BACKUP_HEADER_BYTES = 8 + 1 + SALT_BYTES + IV_BYTES
private val MAGIC = "DRIFTBK1".toByteArray(StandardCharsets.US_ASCII)

data class BackupInfo(
    val createdAt: Long,
    val entries: Int,
    val tasks: Int,
    val routines: Int,
)

class BackupService(
    private val context: Context,
    private val repository: DriftRepository,
    private val settings: SecureSettings,
) {
    suspend fun create(uri: android.net.Uri, password: CharArray): BackupInfo = withContext(Dispatchers.IO) {
        require(password.size >= 10) { "Use a backup password with at least 10 characters." }
        val snapshot = repository.allForSync()
        val createdAt = System.currentTimeMillis()
        val appSettings = settings.current()
        val payload = BackupPayload(
            createdAt = createdAt,
            bundle = snapshot,
            reminders = appSettings.reminders,
            aiModel = appSettings.ai.model,
            aiPersonality = appSettings.ai.personality,
            automaticInsights = appSettings.ai.automaticInsights,
        )
        val plaintext = payload.toJson().toString().toByteArray(StandardCharsets.UTF_8)
        require(plaintext.size <= MAX_ARCHIVE_BYTES - BACKUP_HEADER_BYTES - 16) { "This backup is too large to write safely." }
        val ciphertext = encrypt(plaintext, password)
        context.contentResolver.openOutputStream(uri)?.use { output ->
            output.write(ciphertext)
            output.flush()
        }
            ?: error("Drift could not open that backup location.")
        BackupInfo(createdAt, snapshot.entries.size, snapshot.tasks.size, snapshot.templates.size).also { info ->
            settings.saveBackup(BackupSettings(info.createdAt, info.entries, info.tasks, info.routines))
        }
    }

    suspend fun inspect(uri: android.net.Uri, password: CharArray): BackupInfo = withContext(Dispatchers.IO) {
        decode(uri, password).info()
    }

    suspend fun restore(uri: android.net.Uri, password: CharArray): BackupInfo {
        val payload = withContext(Dispatchers.IO) { decode(uri, password) }
        // The archive is already authenticated and validated.  Hold existing
        // sync credentials until the database transaction succeeds, but do not
        // schedule an upload of restored data with those credentials.
        repository.replaceAllFromBackup(payload.bundle, scheduleSync = false)
        settings.saveSync(SyncSettings())
        settings.saveAi(AiSettings(key = "", model = payload.aiModel, personality = payload.aiPersonality, automaticInsights = payload.automaticInsights))
        settings.saveReminders(payload.reminders)
        settings.saveBackup(BackupSettings(payload.createdAt, payload.bundle.entries.size, payload.bundle.tasks.size, payload.bundle.templates.size))
        return payload.info()
    }

    private fun decode(uri: android.net.Uri, password: CharArray): BackupPayload {
        require(password.isNotEmpty()) { "Enter the backup password." }
        val bytes = context.contentResolver.openInputStream(uri)?.use { input -> readBounded(input) }
            ?: error("Drift could not open that backup.")
        return BackupPayload.fromJson(JSONObject(String(decrypt(bytes, password), StandardCharsets.UTF_8)))
    }
}

private data class BackupPayload(
    val createdAt: Long,
    val bundle: SyncBundle,
    val reminders: ReminderSettings,
    val aiModel: String,
    val aiPersonality: String,
    val automaticInsights: Boolean,
) {
    fun info() = BackupInfo(createdAt, bundle.entries.size, bundle.tasks.size, bundle.templates.size)

    fun toJson() = JSONObject()
        .put("format", "drift-backup")
        .put("version", BACKUP_VERSION)
        .put("createdAt", createdAt)
        .put("entries", JSONArray(bundle.entries.map(Entry::toJson)))
        .put("tasks", JSONArray(bundle.tasks.map(Task::toJson)))
        .put("templates", JSONArray(bundle.templates.map(TaskTemplate::toJson)))
        .put("entryTags", JSONArray(bundle.entryTags.map(EntryTags::toJson)))
        .put("contextMemory", JSONArray(bundle.contextMemory.map(ContextMemory::toJson)))
        .put("sessions", JSONArray(bundle.sessions.map(ChatSession::toJson)))
        .put("rewards", JSONArray(bundle.rewards.map(Reward::toJson)))
        .put("moods", JSONArray(bundle.moods.map(MoodEntry::toJson)))
        .put("settings", JSONObject()
            .put("reminders", reminders.toJson())
            .put("aiModel", aiModel)
            .put("aiPersonality", aiPersonality)
            .put("automaticInsights", automaticInsights),
        )

    companion object {
        fun fromJson(json: JSONObject): BackupPayload {
            require(json.optString("format") == "drift-backup") { "That is not a Drift backup." }
            val version = json.optInt("version")
            require(version in 1..BACKUP_VERSION) { "This backup uses an unsupported version." }
            val createdAt = json.optLong("createdAt")
            require(createdAt > 0) { "This backup is missing its creation date." }
            val settings = json.optJSONObject("settings") ?: JSONObject()
            val reminders = settings.optJSONObject("reminders")?.toReminderSettings() ?: ReminderSettings()
            val payload = BackupPayload(
                createdAt = createdAt,
                bundle = SyncBundle(
                    entries = json.requiredArray("entries").mapJson(::entryFromJson),
                    tasks = json.requiredArray("tasks").mapJson(::taskFromJson),
                    templates = json.requiredArray("templates").mapJson(::templateFromJson),
                    entryTags = json.optionalArray("entryTags").mapJson(::entryTagsFromJson),
                    contextMemory = json.optionalArray("contextMemory").mapJson(::contextMemoryFromJson),
                    sessions = json.optionalArray("sessions").mapJson(::chatSessionFromJson),
                    rewards = json.optionalArray("rewards").mapJson(::rewardFromJson),
                    moods = json.optionalArray("moods").mapJson(::moodFromJson),
                ),
                reminders = reminders,
                aiModel = settings.optString("aiModel", "openai/gpt-4o-mini"),
                aiPersonality = settings.optString("aiPersonality", "coach"),
                automaticInsights = settings.optBoolean("automaticInsights"),
            )
            payload.validate()
            return payload
        }
    }

    private fun validate() {
        val entryIds = bundle.entries.map(Entry::id)
        val taskIds = bundle.tasks.map(Task::id)
        val templateIds = bundle.templates.map(TaskTemplate::id)
        val sessionIds = bundle.sessions.map(ChatSession::id)
        val rewardIds = bundle.rewards.map(Reward::id)
        val moodIds = bundle.moods.map(MoodEntry::id)
        require(entryIds.all(String::isNotBlank) && entryIds.distinct().size == entryIds.size) { "This backup has invalid journal entries." }
        require(taskIds.all(String::isNotBlank) && taskIds.distinct().size == taskIds.size) { "This backup has invalid tasks." }
        require(templateIds.all(String::isNotBlank) && templateIds.distinct().size == templateIds.size) { "This backup has invalid routines." }
        require(sessionIds.all(String::isNotBlank) && sessionIds.distinct().size == sessionIds.size) { "This backup has invalid sessions." }
        require(rewardIds.all(String::isNotBlank) && rewardIds.distinct().size == rewardIds.size) { "This backup has invalid rewards." }
        require(moodIds.all(String::isNotBlank) && moodIds.distinct().size == moodIds.size) { "This backup has invalid mood history." }
        require(bundle.entryTags.all { it.entryId in entryIds && it.taggedAt > 0 && it.updatedAt > 0 }) { "This backup has invalid journal insights." }
        require(bundle.contextMemory.all { it.id == ContextMemory.PRIMARY_ID && it.lastUpdated > 0 && it.updatedAt > 0 }) { "This backup has invalid context memory." }
        require(bundle.sessions.all { it.startedAt > 0 && it.updatedAt > 0 }) { "This backup has invalid session dates." }
        require(bundle.rewards.all { it.earnedAt > 0 && it.updatedAt > 0 }) { "This backup has invalid reward dates." }
        require(bundle.moods.all { it.dateKey.matches(Regex("\\d{4}-\\d{2}-\\d{2}")) && it.mood in 1..5 && it.updatedAt > 0 }) { "This backup has invalid mood history." }
        require(bundle.entries.all { it.createdAt > 0 && it.updatedAt > 0 }) { "This backup has invalid entry dates." }
        require(bundle.tasks.all { it.createdAt > 0 && it.updatedAt > 0 }) { "This backup has invalid task dates." }
        require(bundle.templates.all { it.createdAt > 0 && it.updatedAt > 0 }) { "This backup has invalid routine dates." }
    }
}

private fun encrypt(plaintext: ByteArray, password: CharArray): ByteArray {
    val salt = ByteArray(SALT_BYTES).also(SecureRandom()::nextBytes)
    val iv = ByteArray(IV_BYTES).also(SecureRandom()::nextBytes)
    val keyBytes = deriveKey(password, salt)
    try {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(keyBytes, "AES"), GCMParameterSpec(128, iv))
        val body = cipher.doFinal(plaintext)
        return ByteBuffer.allocate(MAGIC.size + 1 + SALT_BYTES + IV_BYTES + body.size)
            .put(MAGIC)
            .put(BACKUP_VERSION.toByte())
            .put(salt)
            .put(iv)
            .put(body)
            .array()
    } finally {
        keyBytes.fill(0)
    }
}

private fun decrypt(bytes: ByteArray, password: CharArray): ByteArray {
    require(bytes.size > MAGIC.size + 1 + SALT_BYTES + IV_BYTES + 16) { "This backup is incomplete." }
    val input = ByteBuffer.wrap(bytes)
    val magic = ByteArray(MAGIC.size).also(input::get)
    require(magic.contentEquals(MAGIC)) { "That is not a Drift backup." }
    require((input.get().toInt() and 0xFF) in 1..BACKUP_VERSION) { "This backup uses an unsupported version." }
    val salt = ByteArray(SALT_BYTES).also(input::get)
    val iv = ByteArray(IV_BYTES).also(input::get)
    val ciphertext = ByteArray(input.remaining()).also(input::get)
    val keyBytes = deriveKey(password, salt)
    try {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(keyBytes, "AES"), GCMParameterSpec(128, iv))
        return cipher.doFinal(ciphertext)
    } catch (error: Exception) {
        throw IllegalArgumentException("Drift could not unlock that backup. Check the password and file.", error)
    } finally {
        keyBytes.fill(0)
    }
}

private fun deriveKey(password: CharArray, salt: ByteArray): ByteArray {
    val spec = PBEKeySpec(password, salt, PBKDF2_ITERATIONS, KEY_BITS)
    return try {
        SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
    } finally {
        spec.clearPassword()
    }
}

private fun readBounded(input: java.io.InputStream): ByteArray {
    val output = java.io.ByteArrayOutputStream()
    val buffer = ByteArray(8 * 1024)
    while (true) {
        val read = input.read(buffer)
        if (read == -1) break
        require(output.size() + read <= MAX_ARCHIVE_BYTES) { "This backup is too large to restore safely." }
        output.write(buffer, 0, read)
    }
    return output.toByteArray()
}

private fun Entry.toJson() = JSONObject()
    .put("id", id).put("body", body).put("createdAt", createdAt).put("updatedAt", updatedAt)
    .put("mood", mood ?: JSONObject.NULL).put("isDraft", isDraft).put("revision", revision)
    .put("reflection", reflection ?: JSONObject.NULL).put("reflectionRevision", reflectionRevision ?: JSONObject.NULL)
    .put("deletedAt", deletedAt ?: JSONObject.NULL).put("wordCount", wordCount)
    .put("taggingStatus", taggingStatus ?: JSONObject.NULL).put("taggingError", taggingError ?: JSONObject.NULL)

private fun Task.toJson() = JSONObject()
    .put("id", id).put("text", text).put("kind", kind).put("dateKey", dateKey).put("done", done)
    .put("doneAt", doneAt ?: JSONObject.NULL).put("templateId", templateId ?: JSONObject.NULL).put("slot", slot ?: JSONObject.NULL)
    .put("weekKey", weekKey ?: JSONObject.NULL).put("dueDate", dueDate ?: JSONObject.NULL)
    .put("createdAt", createdAt).put("updatedAt", updatedAt).put("deletedAt", deletedAt ?: JSONObject.NULL)
    .put("source", source).put("entryId", entryId ?: JSONObject.NULL)

private fun TaskTemplate.toJson() = JSONObject()
    .put("id", id).put("text", text).put("kind", kind).put("slotsCsv", slotsCsv)
    .put("weeklyTarget", weeklyTarget ?: JSONObject.NULL).put("active", active)
    .put("createdAt", createdAt).put("updatedAt", updatedAt).put("deletedAt", deletedAt ?: JSONObject.NULL)
    .put("sortOrder", sortOrder).put("slotOrdersJson", slotOrdersJson)

private fun EntryTags.toJson() = JSONObject()
    .put("entryId", entryId).put("topicsJson", topicsJson).put("sleepHours", sleepHours ?: JSONObject.NULL)
    .put("moodWordsJson", moodWordsJson).put("tasksOpenJson", tasksOpenJson).put("tasksDoneJson", tasksDoneJson)
    .put("peopleJson", peopleJson).put("oneLineSummary", oneLineSummary).put("taggedAt", taggedAt)
    .put("entryRevision", entryRevision).put("updatedAt", updatedAt).put("deletedAt", deletedAt ?: JSONObject.NULL)

private fun ContextMemory.toJson() = JSONObject()
    .put("id", id).put("patternsJson", patternsJson).put("keyFactsJson", keyFactsJson)
    .put("openLoopsJson", openLoopsJson).put("recentWinsJson", recentWinsJson).put("moodTrend", moodTrend)
    .put("lastUpdated", lastUpdated).put("entryCount", entryCount).put("updatedAt", updatedAt).put("deletedAt", deletedAt ?: JSONObject.NULL)

private fun ChatSession.toJson() = JSONObject()
    .put("id", id).put("startedAt", startedAt).put("updatedAt", updatedAt).put("endedAt", endedAt ?: JSONObject.NULL)
    .put("entryId", entryId ?: JSONObject.NULL).put("messagesJson", messagesJson).put("promptType", promptType).put("deletedAt", deletedAt ?: JSONObject.NULL)

private fun Reward.toJson() = JSONObject()
    .put("id", id).put("type", type).put("earnedAt", earnedAt).put("label", label).put("description", description)
    .put("updatedAt", updatedAt).put("deletedAt", deletedAt ?: JSONObject.NULL)

private fun MoodEntry.toJson() = JSONObject()
    .put("id", id).put("dateKey", dateKey).put("mood", mood).put("entryId", entryId ?: JSONObject.NULL)
    .put("updatedAt", updatedAt).put("deletedAt", deletedAt ?: JSONObject.NULL)

private fun ReminderSettings.toJson() = JSONObject()
    .put("enabled", enabled).put("morning", morning).put("evening", evening).put("taskTime", taskTime)

private fun entryFromJson(json: JSONObject) = Entry(
    id = json.requiredString("id"), body = json.requiredString("body"), createdAt = json.requiredLong("createdAt"), updatedAt = json.requiredLong("updatedAt"),
    mood = json.optionalInt("mood"), isDraft = json.optBoolean("isDraft", true), revision = json.optLong("revision", 1),
    reflection = json.optionalString("reflection"), reflectionRevision = json.optionalLong("reflectionRevision"), deletedAt = json.optionalLong("deletedAt"),
    wordCount = json.optInt("wordCount", json.optString("body").wordCount()), taggingStatus = json.optionalString("taggingStatus"), taggingError = json.optionalString("taggingError"),
)

private fun taskFromJson(json: JSONObject) = Task(
    id = json.requiredString("id"), text = json.requiredString("text"), kind = json.requiredString("kind"), dateKey = json.requiredString("dateKey"),
    done = json.optBoolean("done"), doneAt = json.optionalLong("doneAt"), templateId = json.optionalString("templateId"), slot = json.optionalString("slot"),
    weekKey = json.optionalString("weekKey"), dueDate = json.optionalString("dueDate"), createdAt = json.requiredLong("createdAt"), updatedAt = json.requiredLong("updatedAt"), deletedAt = json.optionalLong("deletedAt"),
    source = json.optString("source", "manual"), entryId = json.optionalString("entryId"),
)

private fun templateFromJson(json: JSONObject) = TaskTemplate(
    id = json.requiredString("id"), text = json.requiredString("text"), kind = json.requiredString("kind"), slotsCsv = json.optString("slotsCsv"),
    weeklyTarget = json.optionalInt("weeklyTarget"), active = json.optBoolean("active", true), createdAt = json.requiredLong("createdAt"), updatedAt = json.requiredLong("updatedAt"), deletedAt = json.optionalLong("deletedAt"),
    sortOrder = json.optInt("sortOrder", 0), slotOrdersJson = json.optString("slotOrdersJson"),
)

private fun entryTagsFromJson(json: JSONObject) = EntryTags(
    entryId = json.requiredString("entryId"), topicsJson = json.optString("topicsJson", "[]"), sleepHours = json.optionalDouble("sleepHours"),
    moodWordsJson = json.optString("moodWordsJson", "[]"), tasksOpenJson = json.optString("tasksOpenJson", "[]"), tasksDoneJson = json.optString("tasksDoneJson", "[]"),
    peopleJson = json.optString("peopleJson", "[]"), oneLineSummary = json.optString("oneLineSummary"), taggedAt = json.requiredLong("taggedAt"),
    entryRevision = json.optLong("entryRevision", 1), updatedAt = json.requiredLong("updatedAt"), deletedAt = json.optionalLong("deletedAt"),
)

private fun contextMemoryFromJson(json: JSONObject) = ContextMemory(
    id = json.requiredString("id"), patternsJson = json.optString("patternsJson", "[]"), keyFactsJson = json.optString("keyFactsJson", "[]"),
    openLoopsJson = json.optString("openLoopsJson", "[]"), recentWinsJson = json.optString("recentWinsJson", "[]"), moodTrend = json.optString("moodTrend"),
    lastUpdated = json.requiredLong("lastUpdated"), entryCount = json.optInt("entryCount"), updatedAt = json.requiredLong("updatedAt"), deletedAt = json.optionalLong("deletedAt"),
)

private fun chatSessionFromJson(json: JSONObject) = ChatSession(
    id = json.requiredString("id"), startedAt = json.requiredLong("startedAt"), updatedAt = json.requiredLong("updatedAt"), endedAt = json.optionalLong("endedAt"),
    entryId = json.optionalString("entryId"), messagesJson = json.optString("messagesJson", "[]"), promptType = json.requiredString("promptType"), deletedAt = json.optionalLong("deletedAt"),
)

private fun rewardFromJson(json: JSONObject) = Reward(
    id = json.requiredString("id"), type = json.requiredString("type"), earnedAt = json.requiredLong("earnedAt"), label = json.requiredString("label"),
    description = json.requiredString("description"), updatedAt = json.requiredLong("updatedAt"), deletedAt = json.optionalLong("deletedAt"),
)

private fun moodFromJson(json: JSONObject) = MoodEntry(
    id = json.requiredString("id"), dateKey = json.requiredString("dateKey"), mood = json.requiredMood(),
    entryId = json.optionalString("entryId"), updatedAt = json.requiredLong("updatedAt"), deletedAt = json.optionalLong("deletedAt"),
)

private fun JSONObject.requiredArray(name: String): JSONArray = optJSONArray(name) ?: throw IllegalArgumentException("This backup is missing $name.")
private fun JSONObject.optionalArray(name: String): JSONArray = optJSONArray(name) ?: JSONArray()
private fun JSONObject.requiredString(name: String): String = optString(name).also { require(it.isNotBlank()) { "This backup is missing $name." } }
private fun JSONObject.requiredLong(name: String): Long = optLong(name).also { require(it > 0) { "This backup has an invalid $name." } }
private fun JSONObject.optionalString(name: String): String? = if (has(name) && !isNull(name)) optString(name).takeIf(String::isNotBlank) else null
private fun JSONObject.optionalLong(name: String): Long? = if (has(name) && !isNull(name)) optLong(name).takeIf { it > 0 } else null
private fun JSONObject.optionalInt(name: String): Int? = if (has(name) && !isNull(name)) optInt(name).takeIf { it > 0 } else null
private fun JSONObject.optionalDouble(name: String): Double? = if (has(name) && !isNull(name)) optDouble(name).takeIf { it.isFinite() && it in 0.0..24.0 } else null
private fun JSONObject.requiredMood(): Int = optInt("mood").also { require(it in 1..5) { "This backup has an invalid mood value." } }
private fun JSONObject.toReminderSettings() = ReminderSettings(optBoolean("enabled"), optString("morning", "08:00"), optString("evening", "20:00"), optString("taskTime", "18:00"))
private fun <T> JSONArray.mapJson(transform: (JSONObject) -> T): List<T> = List(length()) { index -> transform(optJSONObject(index) ?: throw IllegalArgumentException("This backup has an invalid record.")) }
private fun String.wordCount(): Int = trim().split(Regex("\\s+")).count(String::isNotBlank)
