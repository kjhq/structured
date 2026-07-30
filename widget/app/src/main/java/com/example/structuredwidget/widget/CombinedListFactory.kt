package com.example.structuredwidget.widget

import android.content.Context
import com.example.structuredwidget.R
import com.example.structuredwidget.data.DayBlock
import com.example.structuredwidget.data.StructuredTask
import com.example.structuredwidget.data.TaskListItem
import com.example.structuredwidget.data.TodayState
import com.example.structuredwidget.data.WeekState
import com.example.structuredwidget.data.WidgetDisplayState
import com.example.structuredwidget.widget.common.TimeFormat
import com.example.structuredwidget.widget.common.WidgetTheme
import java.time.LocalDate
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.util.Locale

class CombinedListFactory(
    private val use24h: Boolean = false,
    private val compact: Boolean = false,
    private val clock: () -> LocalDate = { LocalDate.now() },
    private val nowProvider: () -> LocalTime = { LocalTime.now() },
) {
    companion object {
        private const val MAX_DUE = 8
        private const val MAX_DUE_COMPACT = 4
        private const val MAX_TOMORROW = 4
        private const val MAX_TIMED_PER_WEEK_DAY = 5
        private const val MAX_INBOX = 8
    }

    fun toRowList(
        todayState: TodayState,
        weekState: WeekState,
        context: Context,
        displayState: WidgetDisplayState = WidgetDisplayState.LIVE,
        timezoneMismatch: Boolean = todayState.timezoneMismatch,
    ): List<TaskListItem> {
        val rows = mutableListOf<TaskListItem>()
        statusBannerFor(context, displayState)?.let { rows += it }
        if (timezoneMismatch && displayState != WidgetDisplayState.DEMO) {
            rows += TaskListItem.StatusBanner(
                message = context.getString(R.string.banner_timezone_mismatch),
                kind = TaskListItem.StatusBanner.Kind.WARNING,
            )
        }
        val accent = todayState.currentAccent ?: WidgetTheme.defaultAccent()
        val today = todayState.logicalDate ?: clock()
        val now = nowProvider()
        val nowHours = now.hour + now.minute / 60.0

        if (todayState.due.isNotEmpty()) {
            val maxDue = if (compact) MAX_DUE_COMPACT else MAX_DUE
            rows += TaskListItem.SectionLabel("DUE · ${todayState.due.size}")
            todayState.due.take(maxDue).forEach { task ->
                rows += TaskListItem.DueRow(
                    task = task,
                    dayLabel = dueDayLabel(task, today),
                    timeLabel = dueTimeLabel(task),
                )
            }
            val overflow = todayState.due.size - maxDue
            if (overflow > 0) rows += TaskListItem.MoreRow(overflow)
        }

        if (todayState.isEmpty) {
            rows += TaskListItem.StatusBanner(
                message = "Nothing scheduled — enjoy the open day",
                kind = TaskListItem.StatusBanner.Kind.EMPTY,
            )
        }

        todayState.hero?.let { hero ->
            val start = hero.startTime
            val startMin = ((start ?: 0.0) * 60).toInt()
            val endMin = startMin + hero.duration
            val nowMin = now.hour * 60 + now.minute

            val (status, countdown, progress) = when {
                start == null -> Triple("ALL DAY", "", 0f)
                nowMin in startMin..endMin -> {
                    val left = endMin - nowMin
                    val span = hero.duration.coerceAtLeast(1)
                    val done = ((nowMin - startMin).toFloat() / span).coerceIn(0f, 1f)
                    Triple("NOW", "${TimeFormat.formatDuration(left)} left", done)
                }
                nowMin < startMin -> {
                    val wait = startMin - nowMin
                    Triple("NEXT", "in ${TimeFormat.formatDuration(wait)}", 0f)
                }
                else -> Triple("DONE", "passed", 1f)
            }

            val range = buildString {
                if (start != null) {
                    append(TimeFormat.formatHour(start, use24h))
                    if (hero.duration > 0) {
                        append(" – ")
                        append(TimeFormat.formatHour(start + hero.duration / 60.0, use24h))
                    }
                    if (hero.duration > 0) {
                        append(" · ")
                        append(TimeFormat.formatDuration(hero.duration))
                    }
                }
            }

            rows += TaskListItem.HeroRow(
                task = hero,
                accent = accent,
                countdown = countdown,
                statusLabel = status,
                progress = progress,
                timeRange = range,
            )
        }

        todayState.allDay
            .filter { it.id != todayState.hero?.id }
            .forEach { rows += TaskListItem.TaskRow(it) }

        todayState.upNext.forEach { t ->
            val start = t.startTime
            val end = if (start != null) start + t.duration / 60.0 else null
            val isCurrent = start != null && end != null && nowHours in start..end
            val isPast = end != null && nowHours > end
            rows += TaskListItem.TaskRow(t, isPast = isPast, isCurrent = isCurrent)
        }

        if (todayState.inbox.isNotEmpty()) {
            rows += TaskListItem.SectionLabel("INBOX · ${todayState.inbox.size}")
            todayState.inbox.take(MAX_INBOX).forEach { rows += TaskListItem.InboxRow(it) }
            val overflow = todayState.inbox.size - MAX_INBOX
            if (overflow > 0) rows += TaskListItem.MoreRow(overflow)
        }

        if (!compact && todayState.tomorrow.isNotEmpty()) {
            val tomorrow = today.plusDays(1)
            val tf = DateTimeFormatter.ofPattern("EEE", Locale.US)
            rows += TaskListItem.SectionLabel(
                "TOMORROW · ${tomorrow.format(tf).uppercase(Locale.US)} · ${todayState.tomorrow.size}",
            )
            todayState.tomorrow.take(MAX_TOMORROW).forEach { rows += TaskListItem.TaskRow(it) }
            val overflow = todayState.tomorrow.size - MAX_TOMORROW
            if (overflow > 0) rows += TaskListItem.MoreRow(overflow)
        }

        if (!compact) {
            rows += TaskListItem.SectionLabel("THIS WEEK")
            for (day in weekState.days) {
                if (day.isToday) continue
                if (day.date == today.plusDays(1) && todayState.tomorrow.isNotEmpty()) continue
                rows += headerFor(day, today)
                if (day.timed.isEmpty() && day.allDay.isEmpty()) {
                    rows += TaskListItem.EmptyDay(day.date)
                    continue
                }
                day.allDay.forEach { rows += TaskListItem.TaskRow(it) }
                day.timed.take(MAX_TIMED_PER_WEEK_DAY).forEach { rows += TaskListItem.TaskRow(it) }
                if (day.timed.size > MAX_TIMED_PER_WEEK_DAY) {
                    rows += TaskListItem.MoreRow(day.timed.size - MAX_TIMED_PER_WEEK_DAY)
                }
            }
        }

        return rows
    }

    private fun headerFor(day: DayBlock, today: LocalDate): TaskListItem.DayHeader {
        val dateFormat = DateTimeFormatter.ofPattern("EEE MMM d", Locale.US)
        val dateText = day.date.format(dateFormat).uppercase(Locale.US)
        val label = when {
            day.isToday -> "●  TODAY · $dateText"
            day.isYesterday -> "$dateText · YESTERDAY"
            day.date == today.plusDays(1) -> "$dateText · TOMORROW"
            else -> dateText
        }
        return TaskListItem.DayHeader(day.date, label, day.isToday, day.isYesterday)
    }

    private fun dueDayLabel(task: StructuredTask, today: LocalDate): String {
        val dayStr = task.day ?: return ""
        val taskDay = LocalDate.parse(dayStr)
        return if (taskDay == today.minusDays(1)) {
            "YEST"
        } else {
            taskDay.format(DateTimeFormatter.ofPattern("MMM d", Locale.US)).uppercase(Locale.US)
        }
    }

    private fun dueTimeLabel(task: StructuredTask): String? {
        if (task.isAllDay || task.startTime == null) return null
        return TimeFormat.formatHour(task.startTime, use24h)
    }

    private fun statusBannerFor(context: Context, state: WidgetDisplayState): TaskListItem.StatusBanner? =
        when (state) {
            WidgetDisplayState.DEMO -> TaskListItem.StatusBanner(
                message = context.getString(R.string.banner_demo),
                kind = TaskListItem.StatusBanner.Kind.INFO,
            )
            WidgetDisplayState.STALE -> TaskListItem.StatusBanner(
                message = context.getString(R.string.banner_stale),
                kind = TaskListItem.StatusBanner.Kind.WARNING,
            )
            WidgetDisplayState.OFFLINE -> TaskListItem.StatusBanner(
                message = context.getString(R.string.banner_offline),
                kind = TaskListItem.StatusBanner.Kind.WARNING,
            )
            WidgetDisplayState.RELINK -> TaskListItem.StatusBanner(
                message = context.getString(R.string.banner_relink),
                kind = TaskListItem.StatusBanner.Kind.ERROR,
            )
            WidgetDisplayState.LIVE -> null
        }
}
