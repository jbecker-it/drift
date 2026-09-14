package com.jbeckerit.drift.backup

import android.content.Context
import com.jbeckerit.drift.data.AiSettings
import com.jbeckerit.drift.data.BackupSettings
import com.jbeckerit.drift.data.DriftRepository
import com.jbeckerit.drift.data.Entry
import com.jbeckerit.drift.data.ReminderSettings
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

private const val BACKUP_VERSION = 1
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
        settings.saveAi(AiSettings(key = "", model = payload.aiModel, personality = payload.aiPersonality))
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
) {
    fun info() = BackupInfo(createdAt, bundle.entries.size, bundle.tasks.size, bundle.templates.size)

    fun toJson() = JSONObject()
        .put("format", "drift-backup")
        .put("version", BACKUP_VERSION)
        .put("createdAt", createdAt)
        .put("entries", JSONArray(bundle.entries.map(Entry::toJson)))
        .put("tasks", JSONArray(bundle.tasks.map(Task::toJson)))
        .put("templates", JSONArray(bundle.templates.map(TaskTemplate::toJson)))
        .put("settings", JSONObject()
            .put("reminders", reminders.toJson())
            .put("aiModel", aiModel)
            .put("aiPersonality", aiPersonality),
        )

    companion object {
        fun fromJson(json: JSONObject): BackupPayload {
            require(json.optString("format") == "drift-backup") { "That is not a Drift backup." }
            require(json.optInt("version") == BACKUP_VERSION) { "This backup uses an unsupported version." }
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
                ),
                reminders = reminders,
                aiModel = settings.optString("aiModel", "openai/gpt-4o-mini"),
                aiPersonality = settings.optString("aiPersonality", "coach"),
            )
            payload.validate()
            return payload
        }
    }

    private fun validate() {
        val entryIds = bundle.entries.map(Entry::id)
        val taskIds = bundle.tasks.map(Task::id)
        val templateIds = bundle.templates.map(TaskTemplate::id)
        require(entryIds.all(String::isNotBlank) && entryIds.distinct().size == entryIds.size) { "This backup has invalid journal entries." }
        require(taskIds.all(String::isNotBlank) && taskIds.distinct().size == taskIds.size) { "This backup has invalid tasks." }
        require(templateIds.all(String::isNotBlank) && templateIds.distinct().size == templateIds.size) { "This backup has invalid routines." }
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
    require((input.get().toInt() and 0xFF) == BACKUP_VERSION) { "This backup uses an unsupported version." }
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
    .put("deletedAt", deletedAt ?: JSONObject.NULL)

private fun Task.toJson() = JSONObject()
    .put("id", id).put("text", text).put("kind", kind).put("dateKey", dateKey).put("done", done)
    .put("doneAt", doneAt ?: JSONObject.NULL).put("templateId", templateId ?: JSONObject.NULL).put("slot", slot ?: JSONObject.NULL)
    .put("weekKey", weekKey ?: JSONObject.NULL).put("dueDate", dueDate ?: JSONObject.NULL)
    .put("createdAt", createdAt).put("updatedAt", updatedAt).put("deletedAt", deletedAt ?: JSONObject.NULL)

private fun TaskTemplate.toJson() = JSONObject()
    .put("id", id).put("text", text).put("kind", kind).put("slotsCsv", slotsCsv)
    .put("weeklyTarget", weeklyTarget ?: JSONObject.NULL).put("active", active)
    .put("createdAt", createdAt).put("updatedAt", updatedAt).put("deletedAt", deletedAt ?: JSONObject.NULL)

private fun ReminderSettings.toJson() = JSONObject()
    .put("enabled", enabled).put("morning", morning).put("evening", evening).put("taskTime", taskTime)

private fun entryFromJson(json: JSONObject) = Entry(
    id = json.requiredString("id"), body = json.requiredString("body"), createdAt = json.requiredLong("createdAt"), updatedAt = json.requiredLong("updatedAt"),
    mood = json.optionalInt("mood"), isDraft = json.optBoolean("isDraft", true), revision = json.optLong("revision", 1),
    reflection = json.optionalString("reflection"), reflectionRevision = json.optionalLong("reflectionRevision"), deletedAt = json.optionalLong("deletedAt"),
)

private fun taskFromJson(json: JSONObject) = Task(
    id = json.requiredString("id"), text = json.requiredString("text"), kind = json.requiredString("kind"), dateKey = json.requiredString("dateKey"),
    done = json.optBoolean("done"), doneAt = json.optionalLong("doneAt"), templateId = json.optionalString("templateId"), slot = json.optionalString("slot"),
    weekKey = json.optionalString("weekKey"), dueDate = json.optionalString("dueDate"), createdAt = json.requiredLong("createdAt"), updatedAt = json.requiredLong("updatedAt"), deletedAt = json.optionalLong("deletedAt"),
)

private fun templateFromJson(json: JSONObject) = TaskTemplate(
    id = json.requiredString("id"), text = json.requiredString("text"), kind = json.requiredString("kind"), slotsCsv = json.optString("slotsCsv"),
    weeklyTarget = json.optionalInt("weeklyTarget"), active = json.optBoolean("active", true), createdAt = json.requiredLong("createdAt"), updatedAt = json.requiredLong("updatedAt"), deletedAt = json.optionalLong("deletedAt"),
)

private fun JSONObject.requiredArray(name: String): JSONArray = optJSONArray(name) ?: throw IllegalArgumentException("This backup is missing $name.")
private fun JSONObject.requiredString(name: String): String = optString(name).also { require(it.isNotBlank()) { "This backup is missing $name." } }
private fun JSONObject.requiredLong(name: String): Long = optLong(name).also { require(it > 0) { "This backup has an invalid $name." } }
private fun JSONObject.optionalString(name: String): String? = if (has(name) && !isNull(name)) optString(name).takeIf(String::isNotBlank) else null
private fun JSONObject.optionalLong(name: String): Long? = if (has(name) && !isNull(name)) optLong(name).takeIf { it > 0 } else null
private fun JSONObject.optionalInt(name: String): Int? = if (has(name) && !isNull(name)) optInt(name).takeIf { it > 0 } else null
private fun JSONObject.toReminderSettings() = ReminderSettings(optBoolean("enabled"), optString("morning", "08:00"), optString("evening", "20:00"), optString("taskTime", "18:00"))
private fun <T> JSONArray.mapJson(transform: (JSONObject) -> T): List<T> = List(length()) { index -> transform(optJSONObject(index) ?: throw IllegalArgumentException("This backup has an invalid record.")) }
