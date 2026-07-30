package com.example.structuredwidget.data

import android.util.Log
import org.json.JSONObject
import java.time.LocalDate
import java.time.LocalTime

private const val TAG = "BackendTaskSource"

/** Loads widget data from a single server snapshot. */
class BackendTaskSource(
    private val client: BackendClient,
) {
    suspend fun fetchSnapshot(ifNoneMatch: String? = null): BackendClient.SnapshotFetchResult =
        client.fetchSnapshot(ifNoneMatch)

    fun parseSnapshotBody(body: String): WidgetSnapshot =
        WidgetSnapshotParser.parse(JSONObject(body))

    companion object {
        /** Build a demo snapshot from sample data for unconfigured widgets. */
        fun demoSnapshot(clock: () -> LocalDate = { LocalDate.now() }): WidgetSnapshot {
            val today = clock()
            val tomorrow = today.plusDays(1)
            val weekTasks = (0..7).flatMap { offset ->
                val d = today.plusDays(offset.toLong())
                SampleData.forDate(d).map { t ->
                    if (t.day == null && !t.isInInbox) t.copy(day = d.toString()) else t
                }
            }
            return WidgetSnapshot(
                logicalDate = today,
                timezone = java.util.TimeZone.getDefault().id,
                dayStartsAt = LocalTime.of(4, 0),
                generatedAt = "",
                version = "demo",
                today = SampleData.forDate(today).map { t ->
                    if (t.day == null && !t.isInInbox) t.copy(day = today.toString()) else t
                },
                inbox = SampleData.inbox(),
                due = SampleData.overdue(),
                tomorrow = SampleData.forDate(tomorrow).map { t ->
                    if (t.day == null && !t.isInInbox) t.copy(day = tomorrow.toString()) else t
                },
                week = weekTasks,
            )
        }
    }
}

/** Legacy multi-endpoint source — kept for tests and fallback parsing helpers. */
class LegacyBackendTaskSource(
    private val client: BackendClient,
) : StructuredTaskSource {

    override suspend fun fetchOneOffTasks(date: LocalDate): List<StructuredTask> {
        Log.w(TAG, "Legacy fetchOneOffTasks called — prefer snapshot")
        return emptyList()
    }

    override suspend fun fetchRecurringTasks(): List<StructuredTask> = emptyList()

    override suspend fun fetchInboxTasks(): List<StructuredTask> = emptyList()

    override suspend fun fetchForwardTasks(startDate: LocalDate, endDate: LocalDate): List<StructuredTask> =
        emptyList()

    override suspend fun fetchOpenTasks(): List<StructuredTask> = emptyList()
}
