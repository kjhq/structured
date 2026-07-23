package com.example.structuredwidget.data

import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.LocalTime

private const val TAG = "BackendTaskSource"

class BackendTaskSource(
    private val client: BackendClient,
) : StructuredTaskSource {

    override suspend fun fetchOneOffTasks(date: LocalDate): List<StructuredTask> =
        withContext(Dispatchers.IO) {
            val arr = client.getJsonArray("/v1/tasks?day=$date")
            parseTimeline(arr).also {
                Log.d(TAG, "fetchOneOffTasks($date) -> ${it.size}")
            }
        }

    override suspend fun fetchRecurringTasks(): List<StructuredTask> = emptyList()
    // Recurring occurrences already merged into day/range responses from the backend.

    override suspend fun fetchInboxTasks(): List<StructuredTask> =
        withContext(Dispatchers.IO) {
            val arr = client.getJsonArray("/v1/inbox")
            parseTimeline(arr).also {
                Log.d(TAG, "fetchInboxTasks -> ${it.size}")
            }
        }

    override suspend fun fetchForwardTasks(
        startDate: LocalDate,
        endDate: LocalDate,
    ): List<StructuredTask> = withContext(Dispatchers.IO) {
        val arr = client.getJsonArray("/v1/tasks?day_from=$startDate&day_to=$endDate")
        parseTimeline(arr).also {
            Log.d(TAG, "fetchForwardTasks -> ${it.size}")
        }
    }

    private fun parseTimeline(arr: JSONArray): List<StructuredTask> {
        return (0 until arr.length()).mapNotNull { i ->
            try {
                fromJson(arr.getJSONObject(i))
            } catch (e: Exception) {
                Log.w(TAG, "Skipping malformed item", e)
                null
            }
        }
    }

    private fun fromJson(json: JSONObject): StructuredTask {
        val id = json.optString("id").ifBlank { "unknown" }
        val day = json.optString("day").takeIf { it.isNotBlank() && it != "null" }
        val startTime = parseStartTime(json)
        val duration = json.optInt("duration_minutes", json.optInt("duration", 0))
        val isAllDay = json.optBoolean("is_all_day", false)
        val completedAt = json.optString("completed_at").takeIf { it.isNotBlank() && it != "null" }
        val notes = json.optString("notes", json.optString("note", ""))
        val color = json.optString("color").ifBlank { "#5e96cb" }
        val symbol = json.optString("symbol").takeIf { it.isNotBlank() && it != "null" }
        val isOccurrence = json.optBoolean("is_occurrence", false)
        val isInInbox = day == null && !isOccurrence
        return StructuredTask(
            id = id,
            title = json.optString("title"),
            day = day,
            startTime = startTime,
            duration = duration,
            isAllDay = isAllDay,
            isInInbox = isInInbox,
            color = color,
            note = notes,
            completedAt = completedAt,
            timezone = null,
            alerts = parseAlerts(json.optJSONArray("alerts")),
            symbol = symbol,
        )
    }

    /** Backend uses HH:MM[:SS]; Structured MCP used fractional hours. */
    private fun parseStartTime(json: JSONObject): Double? {
        if (json.isNull("start_time")) return null
        val raw = json.opt("start_time") ?: return null
        when (raw) {
            is Number -> return raw.toDouble()
            is String -> {
                if (raw.isBlank() || raw == "null") return null
                return try {
                    val t = LocalTime.parse(raw)
                    t.hour + t.minute / 60.0 + t.second / 3600.0
                } catch (_: Exception) {
                    raw.toDoubleOrNull()
                }
            }
            else -> return null
        }
    }

    private fun parseAlerts(json: JSONArray?): List<Alert> {
        if (json == null || json.length() == 0) return emptyList()
        return (0 until json.length()).mapNotNull { i ->
            try {
                val o = json.getJSONObject(i)
                Alert(
                    type = o.optString("kind", o.optString("type", "start")),
                    offset = if (o.isNull("offset_minutes")) {
                        if (o.isNull("offset")) null else o.getInt("offset")
                    } else {
                        o.getInt("offset_minutes")
                    },
                )
            } catch (_: Exception) {
                null
            }
        }
    }
}
