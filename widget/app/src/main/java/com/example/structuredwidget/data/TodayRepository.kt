package com.example.structuredwidget.data

import java.time.LocalDate
import java.time.LocalTime

class TodayRepository(
    private val source: StructuredTaskSource,
    private val clock: () -> LocalDate = { LocalDate.now() },
    private val nowProvider: () -> LocalTime = { LocalTime.now() },
) {
    suspend fun load(): TodayState {
        val today = clock()
        val now = nowProvider()
        val nowHours = now.hour + now.minute / 60.0

        val oneOff = source.fetchOneOffTasks(today)
        val recurring = source.fetchRecurringTasks()
        val inbox = source.fetchInboxTasks().filter { it.completedAt.isNullOrBlank() }
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

        // Hero: currently-in-progress task, else next upcoming, else last of day.
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
                // Prefer future, keep a couple of recent past for context
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
            currentAccent = accent,
            isEmpty = all.isEmpty() && inbox.isEmpty(),
        )
    }
}
