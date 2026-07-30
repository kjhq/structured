package com.example.structuredwidget.data

import java.time.LocalDate

class WeekRepository {
    /** Build week state from snapshot week tasks using server logical date. */
    fun fromSnapshot(snapshot: WidgetSnapshot): WeekState {
        val today = snapshot.logicalDate
        val tasks = snapshot.week
        val days = (0..7).map { offset ->
            val date = today.plusDays(offset.toLong())
            val dayTasks = tasks.filter { it.day == date.toString() }
            val sorted = dayTasks.sortedBy { it.startTime }
            val timed = sorted.filter { !it.isAllDay }
            val allDay = sorted.filter { it.isAllDay }
            DayBlock(
                date = date,
                timed = timed,
                allDay = allDay,
                totalTasks = timed.size + allDay.size,
                isToday = date == today,
                isYesterday = date == today.minusDays(1),
            )
        }
        return WeekState(days = days)
    }

    /** Legacy multi-fetch path for tests using [StructuredTaskSource]. */
    suspend fun load(source: StructuredTaskSource, clock: () -> LocalDate = { LocalDate.now() }): WeekState {
        val today = clock()
        val start = today
        val end = today.plusDays(7)
        val tasks = source.fetchForwardTasks(start, end)
        val days = (0..7).map { offset ->
            val date = today.plusDays(offset.toLong())
            val dayTasks = tasks.filter { it.day == date.toString() }
            val sorted = dayTasks.sortedBy { it.startTime }
            val timed = sorted.filter { !it.isAllDay }
            val allDay = sorted.filter { it.isAllDay }
            DayBlock(
                date = date,
                timed = timed,
                allDay = allDay,
                totalTasks = timed.size + allDay.size,
                isToday = date == today,
                isYesterday = date == today.minusDays(1),
            )
        }
        return WeekState(days = days)
    }
}
