package com.example.structuredwidget.data

import java.time.LocalDate

/**
 * Rich demo schedule used when the user is not authenticated (widget preview + guest mode).
 */
object SampleData {

    fun forDate(date: LocalDate): List<StructuredTask> {
        val today = LocalDate.now()
        val day = date.toString()
        return when {
            date == today -> listOf(
                task("s1", "Morning workout", day, 7.0, 60, color = "#FF6B6B", symbol = "dumbbell"),
                task("s2", "Deep work block", day, 9.5, 90, color = "#5E96CB", symbol = "pencil"),
                task("s3", "Team standup", day, 11.0, 30, color = "#4ECDC4", symbol = "text.badge.checkmark"),
                task("s4", "Lunch", day, 12.5, 45, color = "#F7B731", symbol = "sun.max.fill"),
                task("s5", "Design review", day, 14.0, 60, color = "#A55EEA", symbol = "pencil.and.outline"),
                task("s6", "Commute home", day, 18.0, 40, color = "#26C6DA", symbol = "car"),
                task("s7", "Wind down", day, 21.5, 30, color = "#778BEB", symbol = "moon.fill"),
                task("s8", "All-day focus flag", day, null, 0, isAllDay = true, color = "#45AAF2", symbol = "flag"),
            )
            date == today.plusDays(1) -> listOf(
                task("t1", "Doctor appointment", day, 10.0, 45, color = "#FC5C65", symbol = "alarm.fill"),
                task("t2", "Write weekly review", day, 15.0, 60, color = "#5E96CB", symbol = "pencil"),
            )
            date == today.plusDays(2) -> listOf(
                task("u1", "Bike ride", day, 7.5, 75, color = "#26DE81", symbol = "bicycle"),
                task("u2", "Groceries", day, 17.0, 40, color = "#FD9644", symbol = "house"),
            )
            date == today.plusDays(3) -> listOf(
                task("v1", "Project deadline", day, null, 0, isAllDay = true, color = "#EB3B5A", symbol = "calendar"),
                task("v2", "Dinner with friends", day, 19.0, 90, color = "#F7B731", symbol = "sun.fill"),
            )
            else -> emptyList()
        }
    }

    fun inbox(): List<StructuredTask> = listOf(
        task("i1", "Reply to Alex", null, null, 0, isInInbox = true, color = "#5E96CB", symbol = "text.bubble"),
        task("i2", "Book flights", null, null, 0, isInInbox = true, color = "#A55EEA", symbol = "airplane"),
        task("i3", "Order new charger", null, null, 0, isInInbox = true, color = "#26C6DA", symbol = "bag"),
    )

    private fun task(
        id: String,
        title: String,
        day: String?,
        startTime: Double?,
        duration: Int,
        isAllDay: Boolean = false,
        isInInbox: Boolean = false,
        color: String,
        symbol: String?,
    ) = StructuredTask(
        id = id,
        title = title,
        day = day,
        startTime = startTime,
        duration = duration,
        isAllDay = isAllDay,
        isInInbox = isInInbox,
        color = color,
        note = "",
        completedAt = null,
        timezone = null,
        alerts = emptyList(),
        symbol = symbol,
    )
}

object SampleDataSource : StructuredTaskSource {
    override suspend fun fetchOneOffTasks(date: LocalDate): List<StructuredTask> =
        SampleData.forDate(date).map { t ->
            // Stamp day so week grouping works
            if (t.day == null && !t.isInInbox) t.copy(day = date.toString()) else t
        }

    override suspend fun fetchRecurringTasks(): List<StructuredTask> = emptyList()

    override suspend fun fetchInboxTasks(): List<StructuredTask> = SampleData.inbox()

    override suspend fun fetchForwardTasks(startDate: LocalDate, endDate: LocalDate): List<StructuredTask> {
        val days = java.time.temporal.ChronoUnit.DAYS.between(startDate, endDate).toInt()
        return (0..days).flatMap { offset ->
            val d = startDate.plusDays(offset.toLong())
            SampleData.forDate(d).map { t ->
                if (t.day == null && !t.isInInbox) t.copy(day = d.toString()) else t
            }
        }
    }
}
