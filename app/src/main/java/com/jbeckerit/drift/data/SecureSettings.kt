package com.jbeckerit.drift.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import org.json.JSONObject
import java.nio.ByteBuffer
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

data class AiSettings(val key: String = "", val model: String = "openai/gpt-4o-mini", val personality: String = "coach")
data class ReminderSettings(val enabled: Boolean = false, val morning: String = "08:00", val evening: String = "20:00", val taskTime: String = "18:00")
data class SyncSettings(val enabled: Boolean = false, val url: String = "", val username: String = "", val password: String = "")
data class OnboardingSettings(val completed: Boolean = false)
data class BackupSettings(val lastSuccessAt: Long? = null, val entries: Int = 0, val tasks: Int = 0, val routines: Int = 0)
data class AppSettings(
    val ai: AiSettings = AiSettings(),
    val reminders: ReminderSettings = ReminderSettings(),
    val sync: SyncSettings = SyncSettings(),
    val onboarding: OnboardingSettings = OnboardingSettings(),
    val backup: BackupSettings = BackupSettings(),
)

class SecureSettings(context: Context) {
    private val prefs = context.getSharedPreferences("drift.settings", Context.MODE_PRIVATE)
    private val _state = MutableStateFlow(readAll())
    val state: StateFlow<AppSettings> = _state

    fun current() = _state.value
    fun saveAi(value: AiSettings) = save("ai", JSONObject().put("key", value.key).put("model", value.model).put("personality", value.personality).toString())
    fun saveReminders(value: ReminderSettings) = save("reminders", JSONObject().put("enabled", value.enabled).put("morning", value.morning).put("evening", value.evening).put("taskTime", value.taskTime).toString())
    fun saveSync(value: SyncSettings) = save("sync", JSONObject().put("enabled", value.enabled).put("url", value.url).put("username", value.username).put("password", value.password).toString())
    fun saveOnboarding(value: OnboardingSettings) = save("onboarding", JSONObject().put("completed", value.completed).toString())
    fun saveBackup(value: BackupSettings) = save("backup", JSONObject().put("lastSuccessAt", value.lastSuccessAt ?: JSONObject.NULL).put("entries", value.entries).put("tasks", value.tasks).put("routines", value.routines).toString())

    private fun save(name: String, raw: String) {
        prefs.edit().putString(name, encrypt(raw)).apply()
        _state.value = readAll()
    }

    private fun readAll() = AppSettings(readAi(), readReminders(), readSync(), readOnboarding(), readBackup())
    private fun readAi() = runCatching { JSONObject(read("ai") ?: return@runCatching AiSettings()).let { AiSettings(it.optString("key"), it.optString("model", "openai/gpt-4o-mini"), it.optString("personality", "coach")) } }.getOrDefault(AiSettings())
    private fun readReminders() = runCatching { JSONObject(read("reminders") ?: return@runCatching ReminderSettings()).let { ReminderSettings(it.optBoolean("enabled"), it.optString("morning", "08:00"), it.optString("evening", "20:00"), it.optString("taskTime", "18:00")) } }.getOrDefault(ReminderSettings())
    private fun readSync() = runCatching { JSONObject(read("sync") ?: return@runCatching SyncSettings()).let { SyncSettings(it.optBoolean("enabled"), it.optString("url"), it.optString("username"), it.optString("password")) } }.getOrDefault(SyncSettings())
    private fun readOnboarding() = runCatching { JSONObject(read("onboarding") ?: return@runCatching OnboardingSettings()).let { OnboardingSettings(it.optBoolean("completed")) } }.getOrDefault(OnboardingSettings())
    private fun readBackup() = runCatching { JSONObject(read("backup") ?: return@runCatching BackupSettings()).let { BackupSettings(if (it.has("lastSuccessAt") && !it.isNull("lastSuccessAt")) it.optLong("lastSuccessAt").takeIf { value -> value > 0 } else null, it.optInt("entries"), it.optInt("tasks"), it.optInt("routines")) } }.getOrDefault(BackupSettings())
    private fun read(name: String) = prefs.getString(name, null)?.let(::decrypt)

    private fun encrypt(text: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val data = cipher.doFinal(text.toByteArray())
        val joined = ByteBuffer.allocate(4 + cipher.iv.size + data.size).putInt(cipher.iv.size).put(cipher.iv).put(data).array()
        return Base64.encodeToString(joined, Base64.NO_WRAP)
    }

    private fun decrypt(text: String): String {
        val bytes = ByteBuffer.wrap(Base64.decode(text, Base64.NO_WRAP))
        val size = bytes.int
        require(size in 12..32)
        val iv = ByteArray(size).also(bytes::get)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, iv))
        return cipher.doFinal(ByteArray(bytes.remaining()).also(bytes::get)).toString(Charsets.UTF_8)
    }

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey("drift.settings.v2", null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(
                KeyGenParameterSpec.Builder("drift.settings.v2", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build(),
            )
        }.generateKey()
    }
}
