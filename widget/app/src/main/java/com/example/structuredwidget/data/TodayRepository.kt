package com.example.structuredwidget.data

import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId

class TodayRepository(
    private val nowProvider: () -> LocalTime = { LocalTime.now() },
) {
    /** Build today state from a single atomic snapshot. */
    fun fromSnapshot(snapshot: WidgetSnapshot): TodayState {
        val today = snapshot.logicalDate
        val now = nowProvider()
        val nowHours = now.hour + now.minute / 60.0

        val inbox = snapshot.inbox.filter { it.completedAt.isNullOrBlank() }
        val due = snapshot.due
            .filter { it.completedAt.isNullOrBlank() }
            .sortedWith(
                compareByDescending<StructuredTask> { it.day.orEmpty() }
                    .thenBy { it.startTime ?: Double.MAX_VALUE },
            )
        val tomorrow = snapshot.tomorrow.filter { it.completedAt.isNullOrBlank() }

        val all = snapshot.today
            .filter { it.completedAt.isNullOrBlank() }

        val sorted = all.sortedWith(
            compareBy<StructuredTask> { it.isAllDay }
                .thenBy { it.startTime ?: Double.MAX_VALUE },
        )
        val allDay = sorted.filter { it.isAllDay }
        val timed = sorted.filter { !it.isAllDay }

        val inProgress = timed.firstOrNull { t ->
            val start = t.startTime ?: return@firstOrNull false
            val end = start + t.duration / 60.0
            nowHours in start..end
        }
        val upcoming = timed.filter {
            val start = it.startTime ?: return@filter false
            start > nowHours
        }
        val hero = inProgress ?: upcoming.firstOrNull() ?: timed.lastOrNull()

        val upNext = timed
            .filter { it.id != hero?.id }
            .filter { t ->
                val start = t.startTime
                start == null || start >= nowHours - 0.5
            }
            .take(6)

        val accent = try {
            hero?.color?.let { android.graphics.Color.parseColor(it) }
        } catch (_: Exception) {
            null
        }

        return TodayState(
            allDay = allDay,
            hero = hero,
            upNext = upNext,
            inbox = inbox,
            tomorrow = tomorrow,
            due = due,
            currentAccent = accent,
            isEmpty = all.isEmpty() && inbox.isEmpty() && due.isEmpty(),
            logicalDate = today,
            serverTimezone = snapshot.timezone,
            timezoneMismatch = isTimezoneMismatch(snapshot.timezone),
        )
    }

    /** Legacy multi-fetch path for tests using [StructuredTaskSource]. */
    suspend fun load(source: StructuredTaskSource, clock: () -> LocalDate = { LocalDate.now() }): TodayState {
        val today = clock()
        val now = nowProvider()
        val nowHours = now.hour + now.minute / 60.0

        val oneOff = source.fetchOneOffTasks(today)
        val recurring = source.fetchRecurringTasks()
        val inbox = source.fetchInboxTasks().filter { it.completedAt.isNullOrBlank() }
        val due = source.fetchOpenTasks()
            .filter { it.completedAt.isNullOrBlank() }
            .sortedWith(
                compareByDescending<StructuredTask> { it.day.orEmpty() }
                    .thenBy { it.startTime ?: Double.MAX_VALUE },
            )
        val tomorrow = source.fetchForwardTasks(today.plusDays(1), today.plusDays(1))
            .filter { it.completedAt.isNullOrBlank() }

        val all = (oneOff + recurring)
            .filter { it.day == null || it.day == today.toString() }
            .filter { it.completedAt.isNullOrBlank() }

        val sorted = all.sortedWith(
            compareBy<StructuredTask> { it.isAllDay }
                .thenBy { it.startTime ?: Double.MAX_VALUE },
        )
        val allDay = sorted.filter { it.isAllDay }
        val timed = sorted.filter { !it.isAllDay }

        val inProgress = timed.firstOrNull { t ->
            val start = t.startTime ?: return@firstOrNull false
            val end = start + t.duration / 60.0
            nowHours in start..end
        }
        val upcoming = timed.filter {
            val start = it.startTime ?: return@filter false
            start > nowHours
        }
        val hero = inProgress ?: upcoming.firstOrNull() ?: timed.lastOrNull()

        val upNext = timed
            .filter { it.id != hero?.id }
            .filter { t ->
                val start = t.startTime
                start == null || start >= nowHours - 0.5
            }
            .take(6)

        val accent = try {
            hero?.color?.let { android.graphics.Color.parseColor(it) }
        } catch (_: Exception) {
            null
        }

        return TodayState(
            allDay = allDay,
            hero = hero,
            upNext = upNext,
            inbox = inbox,
            tomorrow = tomorrow,
            due = due,
            currentAccent = accent,
            isEmpty = all.isEmpty() && inbox.isEmpty() && due.isEmpty(),
            logicalDate = today,
            serverTimezone = null,
            timezoneMismatch = false,
        )
    }

    companion object {
        fun isTimezoneMismatch(serverTimezone: String): Boolean {
            if (serverTimezone.isBlank()) return false
            val deviceTz = ZoneId.systemDefault().id
            return !deviceTz.equals(serverTimezone, ignoreCase = true)
        }
    }
}
