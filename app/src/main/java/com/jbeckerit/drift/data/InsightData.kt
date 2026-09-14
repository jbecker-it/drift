package com.jbeckerit.drift.data

import org.json.JSONArray
import org.json.JSONObject

data class EntryMentions(
    val sleepHours: Double? = null,
    val moodWords: List<String> = emptyList(),
    val tasksOpen: List<String> = emptyList(),
    val tasksDone: List<String> = emptyList(),
    val people: List<String> = emptyList(),
)

data class EntryTagData(
    val topics: List<String> = emptyList(),
    val mentions: EntryMentions = EntryMentions(),
    val oneLineSummary: String = "",
)

fun EntryTags.toTagData() = EntryTagData(
    topics = topicsJson.toStringList(),
    mentions = EntryMentions(
        sleepHours = sleepHours,
        moodWords = moodWordsJson.toStringList(),
        tasksOpen = tasksOpenJson.toStringList(),
        tasksDone = tasksDoneJson.toStringList(),
        people = peopleJson.toStringList(),
    ),
    oneLineSummary = oneLineSummary,
)

internal fun List<String>.toJsonList(): String = JSONArray(map { it.trim() }.filter(String::isNotBlank)).toString()

internal fun String.toStringList(): List<String> = runCatching {
    val values = JSONArray(this)
    List(values.length()) { index -> values.optString(index).trim() }.filter(String::isNotBlank)
}.getOrDefault(emptyList())

internal fun List<StoredChatMessage>.toMessagesJson(): String = JSONArray(map { message ->
    JSONObject().put("role", message.role).put("content", message.content).put("timestamp", message.timestamp)
}).toString()

internal fun String.toStoredChatMessages(): List<StoredChatMessage> = runCatching {
    val values = JSONArray(this)
    List(values.length()) { index ->
        values.optJSONObject(index)?.let { value ->
            val role = value.optString("role").takeIf { it == "user" || it == "assistant" }
            val content = value.optString("content").trim().takeIf(String::isNotBlank)
            val timestamp = value.optLong("timestamp").takeIf { it > 0 }
            if (role != null && content != null && timestamp != null) StoredChatMessage(role, content, timestamp) else null
        }
    }.filterNotNull()
}.getOrDefault(emptyList())
