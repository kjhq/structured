package com.example.structuredwidget.data

import java.time.LocalDate

data class WeekState(val days: List<DayBlock>)

data class DayBlock(
    val date: LocalDate,
    val timed: List<StructuredTask>,
    val allDay: List<StructuredTask>,
    val totalTasks: Int,
    val isToday: Boolean,
    val isYesterday: Boolean,
)
