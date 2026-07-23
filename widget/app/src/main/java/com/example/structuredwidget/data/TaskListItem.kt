package com.example.structuredwidget.data

import java.time.LocalDate

sealed class TaskListItem {
    data class DayHeader(
        val date: LocalDate,
        val label: String,
        val isToday: Boolean,
        val isYesterday: Boolean,
    ) : TaskListItem()

    /** Day-progress ribbon: fraction of day elapsed (0..1) plus labels. */
    data class DayProgress(
        val progress: Float,
        val startLabel: String,
        val endLabel: String,
        val nowLabel: String,
        val accent: Int,
    ) : TaskListItem()

    data class TaskRow(
        val task: StructuredTask,
        val isPast: Boolean = false,
        val isCurrent: Boolean = false,
    ) : TaskListItem()

    data class InboxRow(val task: StructuredTask) : TaskListItem()
    data class MoreRow(val count: Int) : TaskListItem()
    data class EmptyDay(val date: LocalDate) : TaskListItem()

    data class HeroRow(
        val task: StructuredTask,
        val accent: Int,
        val countdown: String,
        val statusLabel: String,
        val progress: Float,
        val timeRange: String,
    ) : TaskListItem()

    data class SectionLabel(val label: String) : TaskListItem()

    data class StatusBanner(
        val message: String,
        val kind: Kind,
    ) : TaskListItem() {
        enum class Kind { INFO, EMPTY, ERROR }
    }
}
