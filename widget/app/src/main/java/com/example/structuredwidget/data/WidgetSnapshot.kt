package com.example.structuredwidget.data

import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.LocalTime

/** Server-authoritative widget payload from GET /v1/widget/snapshot. */
data class WidgetSnapshot(
    val logicalDate: LocalDate,
    val timezone: String,
    val dayStartsAt: LocalTime,
    val generatedAt: String,
    val version: String,
    val today: List<StructuredTask>,
    val inbox: List<StructuredTask>,
    val due: List<StructuredTask>,
    val tomorrow: List<StructuredTask>,
    val week: List<StructuredTask>,
)

object WidgetSnapshotParser {

    fun parse(json: JSONObject): WidgetSnapshot {
        val logicalDate = LocalDate.parse(json.getString("logical_date"))
        val dayStartsRaw = json.optString("day_starts_at", "00:00:00")
        val dayStartsAt = parseLocalTime(dayStartsRaw)
        return WidgetSnapshot(
            logicalDate = logicalDate,
            timezone = json.getString("timezone"),
            dayStartsAt = dayStartsAt,
            generatedAt = json.optString("generated_at", ""),
            version = json.getString("version"),
            today = parseTimeline(json.optJSONArray("today")),
            inbox = parseTimeline(json.optJSONArray("inbox")),
            due = parseTimeline(json.optJSONArray("due")),
            tomorrow = parseTimeline(json.optJSONArray("tomorrow")),
            week = parseTimeline(json.optJSONArray("week")),
        )
    }

    fun parseTimeline(arr: JSONArray?): List<StructuredTask> {
        if (arr == null || arr.length() == 0) return emptyList()
        return (0 until arr.length()).mapNotNull { i ->
            try {
                fromJson(arr.getJSONObject(i))
            } catch (_: Exception) {
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

    private fun parseLocalTime(raw: String): LocalTime =
        try {
            LocalTime.parse(raw)
        } catch (_: Exception) {
            LocalTime.MIDNIGHT
        }
}
