package com.example.structuredwidget.widget

import android.content.Context
import com.example.structuredwidget.data.DayBlock
import com.example.structuredwidget.data.TaskListItem
import com.example.structuredwidget.data.TodayState
import com.example.structuredwidget.data.WeekState
import com.example.structuredwidget.widget.common.TimeFormat
import com.example.structuredwidget.widget.common.WidgetTheme
import java.time.LocalDate
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.util.Locale

class CombinedListFactory(
    private val use24h: Boolean = false,
    private val clock: () -> LocalDate = { LocalDate.now() },
    private val nowProvider: () -> LocalTime = { LocalTime.now() },
) {
    companion object {
        private const val MAX_TOMORROW = 3
        private const val MAX_TIMED_PER_WEEK_DAY = 4
        private const val MAX_INBOX = 8
    }

    fun toRowList(
        todayState: TodayState,
        weekState: WeekState,
        @Suppress("UNUSED_PARAMETER") context: Context,
    ): List<TaskListItem> {
        val rows = mutableListOf<TaskListItem>()
        val accent = todayState.currentAccent ?: WidgetTheme.defaultAccent()
        val today = clock()
        val now = nowProvider()
        val nowHours = now.hour + now.minute / 60.0

        // —— TODAY ——
        val todayDf = DateTimeFormatter.ofPattern("EEEE, MMMM d", Locale.US)
        val todayLabel = "●  TODAY · ${today.format(todayDf).uppercase(Locale.US)}"
        rows += TaskListItem.DayHeader(today, todayLabel, isToday = true, isYesterday = false)

        // Day progress ribbon
        rows += TaskListItem.DayProgress(
            progress = TimeFormat.hourOfDayFraction(now.hour, now.minute),
            startLabel = if (use24h) "00:00" else "12a",
            endLabel = if (use24h) "24:00" else "12a",
            nowLabel = TimeFormat.formatHour(nowHours, use24h),
            accent = accent,
        )

        if (todayState.isEmpty) {
            rows += TaskListItem.StatusBanner(
                message = "Nothing scheduled — enjoy the open day",
                kind = TaskListItem.StatusBanner.Kind.EMPTY,
            )
        }

        // Hero
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

        // All-day
        todayState.allDay
            .filter { it.id != todayState.hero?.id }
            .forEach { rows += TaskListItem.TaskRow(it) }

        // Up next (with past/current flags)
        todayState.upNext.forEach { t ->
            val start = t.startTime
            val end = if (start != null) start + t.duration / 60.0 else null
            val isCurrent = start != null && end != null && nowHours in start..end
            val isPast = end != null && nowHours > end
            rows += TaskListItem.TaskRow(t, isPast = isPast, isCurrent = isCurrent)
        }

        // Inbox
        if (todayState.inbox.isNotEmpty()) {
            rows += TaskListItem.SectionLabel("INBOX · ${todayState.inbox.size}")
            todayState.inbox.take(MAX_INBOX).forEach { rows += TaskListItem.InboxRow(it) }
            val overflow = todayState.inbox.size - MAX_INBOX
            if (overflow > 0) rows += TaskListItem.MoreRow(overflow)
        }

        // Tomorrow preview
        if (todayState.tomorrow.isNotEmpty()) {
            val tomorrow = today.plusDays(1)
            val tf = DateTimeFormatter.ofPattern("EEE", Locale.US)
            rows += TaskListItem.SectionLabel(
                "TOMORROW · ${tomorrow.format(tf).uppercase(Locale.US)} · ${todayState.tomorrow.size}",
            )
            todayState.tomorrow.take(MAX_TOMORROW).forEach { rows += TaskListItem.TaskRow(it) }
            val overflow = todayState.tomorrow.size - MAX_TOMORROW
            if (overflow > 0) rows += TaskListItem.MoreRow(overflow)
        }

        // —— WEEK ——
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
}
