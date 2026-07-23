package com.example.structuredwidget.widget

import android.content.Context
import android.content.Intent
import android.util.Log
import android.view.View
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import com.example.structuredwidget.R
import com.example.structuredwidget.data.ApiCredentials
import com.example.structuredwidget.data.BackendClient
import com.example.structuredwidget.data.BackendTaskSource
import com.example.structuredwidget.data.SampleDataSource
import com.example.structuredwidget.data.StructuredTaskSource
import com.example.structuredwidget.data.TaskListItem
import com.example.structuredwidget.data.TodayRepository
import com.example.structuredwidget.data.WeekRepository
import com.example.structuredwidget.widget.common.TimeFormat
import com.example.structuredwidget.widget.common.WidgetIconLibrary
import com.example.structuredwidget.widget.common.WidgetTheme
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull

private const val TAG = "CombinedWidgetService"
private const val CACHE_TTL_MS = 60_000L
private const val FALLBACK_LOAD_TIMEOUT_MS = 15_000L

class CombinedWidgetService : RemoteViewsService() {
    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory =
        CombinedRemoteViewsFactory(applicationContext)
}

private class CombinedRemoteViewsFactory(
    private val context: Context,
) : RemoteViewsService.RemoteViewsFactory {

    private var rows: List<TaskListItem> = emptyList()
    private var use24h: Boolean = false

    override fun onCreate() = Unit
    override fun onDestroy() = Unit

    override fun onDataSetChanged() {
        use24h = android.text.format.DateFormat.is24HourFormat(context)
        val cached = CombinedDataCache.get()
        val cacheAge = CombinedDataCache.age()
        Log.d(TAG, "onDataSetChanged: cached=${cached.size} age=${cacheAge}ms")
        if (cached.isNotEmpty() && cacheAge < CACHE_TTL_MS) {
            rows = cached
            return
        }
        val credentials = ApiCredentials(context)
        val source: StructuredTaskSource = if (credentials.isConfigured()) {
            BackendTaskSource(BackendClient(credentials))
        } else {
            SampleDataSource
        }
        val newRows = try {
            runBlocking {
                withTimeoutOrNull(FALLBACK_LOAD_TIMEOUT_MS) {
                    val todayState = TodayRepository(source).load()
                    val weekState = WeekRepository(source).load()
                    CombinedListFactory(use24h = use24h)
                        .toRowList(todayState, weekState, context)
                }
            }
        } catch (e: Throwable) {
            Log.e(TAG, "fallback load failed", e)
            null
        }
        when {
            newRows != null -> {
                CombinedDataCache.set(newRows, manual = false)
                rows = newRows
            }
            cached.isNotEmpty() -> rows = cached
            else -> rows = emptyList()
        }
    }

    override fun getCount(): Int = rows.size

    override fun getViewAt(position: Int): RemoteViews {
        if (position >= rows.size) return loadingView()
        return when (val row = rows[position]) {
            is TaskListItem.DayHeader -> dayHeaderView(row)
            is TaskListItem.DayProgress -> dayProgressView(row)
            is TaskListItem.HeroRow -> heroRowView(row)
            is TaskListItem.SectionLabel -> sectionLabelView(row)
            is TaskListItem.TaskRow -> taskRowView(row)
            is TaskListItem.InboxRow -> inboxRowView(row)
            is TaskListItem.MoreRow -> moreRowView(row.count)
            is TaskListItem.EmptyDay -> emptyRowView()
            is TaskListItem.StatusBanner -> statusBannerView(row)
        }
    }

    override fun getLoadingView(): RemoteViews = loadingView()
    override fun getViewTypeCount(): Int = 9
    override fun getItemId(position: Int): Long = position.toLong()
    override fun hasStableIds(): Boolean = true

    private fun loadingView(): RemoteViews =
        RemoteViews(context.packageName, R.layout.widget_week_empty_row).apply {
            setTextViewText(R.id.week_empty_row_label, "")
        }

    private fun dayHeaderView(h: TaskListItem.DayHeader): RemoteViews {
        val v = RemoteViews(context.packageName, R.layout.widget_week_day_header)
        v.setOnClickFillInIntent(R.id.row_root, Intent())
        v.setTextViewText(R.id.week_day_header_label, h.label)
        v.setTextColor(
            R.id.week_day_header_label,
            if (h.isYesterday) WidgetTheme.TEXT_MUTED else WidgetTheme.TEXT_PRIMARY,
        )
        return v
    }

    private fun dayProgressView(p: TaskListItem.DayProgress): RemoteViews {
        val v = RemoteViews(context.packageName, R.layout.widget_day_progress_row)
        v.setOnClickFillInIntent(R.id.row_root, Intent())
        v.setProgressBar(R.id.day_progress_bar, 100, (p.progress * 100).toInt().coerceIn(0, 100), false)
        v.setTextViewText(R.id.day_progress_start, p.startLabel)
        v.setTextViewText(R.id.day_progress_now, "NOW · ${p.nowLabel}")
        v.setTextViewText(R.id.day_progress_end, p.endLabel)
        return v
    }

    private fun heroRowView(r: TaskListItem.HeroRow): RemoteViews {
        val v = RemoteViews(context.packageName, R.layout.widget_combined_hero_row)
        v.setOnClickFillInIntent(R.id.row_root, Intent())
        v.setImageViewResource(R.id.combined_hero_icon, WidgetIconLibrary.iconResFor(r.task.symbol))
        v.setInt(R.id.combined_hero_icon, "setColorFilter", r.accent)
        v.setTextViewText(R.id.combined_hero_title, r.task.title)
        v.setTextViewText(R.id.combined_hero_time, r.timeRange)
        v.setTextColor(R.id.combined_hero_time, WidgetTheme.TEXT_SECONDARY)

        v.setTextViewText(R.id.combined_hero_badge, r.statusLabel)
        val badgeColor = when (r.statusLabel) {
            "NOW" -> WidgetTheme.SUCCESS
            "NEXT" -> WidgetTheme.WARNING
            else -> WidgetTheme.TEXT_MUTED
        }
        v.setTextColor(R.id.combined_hero_badge, badgeColor)
        v.setTextViewText(R.id.combined_hero_countdown, r.countdown)
        v.setTextColor(R.id.combined_hero_countdown, WidgetTheme.TEXT_SECONDARY)
        v.setProgressBar(
            R.id.combined_hero_progress,
            100,
            (r.progress * 100).toInt().coerceIn(0, 100),
            false,
        )
        val progressVisible = if (r.statusLabel == "NOW" || r.progress > 0f) View.VISIBLE else View.GONE
        v.setViewVisibility(R.id.combined_hero_progress, progressVisible)
        return v
    }

    private fun sectionLabelView(s: TaskListItem.SectionLabel): RemoteViews {
        val v = RemoteViews(context.packageName, R.layout.widget_combined_section_label)
        v.setOnClickFillInIntent(R.id.row_root, Intent())
        v.setTextViewText(R.id.combined_section_label, s.label)
        return v
    }

    private fun taskRowView(r: TaskListItem.TaskRow): RemoteViews {
        val v = RemoteViews(context.packageName, R.layout.widget_week_task_row)
        v.setOnClickFillInIntent(R.id.row_root, Intent())
        val t = r.task
        val timeText = when {
            t.isAllDay -> "all day"
            t.startTime != null -> TimeFormat.formatHour(t.startTime, use24h)
            else -> ""
        }
        v.setTextViewText(R.id.week_task_row_time, timeText)
        v.setImageViewResource(R.id.week_task_row_icon, WidgetIconLibrary.iconResFor(t.symbol))

        val accent = WidgetTheme.parseColor(t.color)
        v.setInt(R.id.week_task_row_color, "setColorFilter", accent)
        v.setInt(R.id.week_task_row_icon, "setColorFilter",
            if (r.isPast) WidgetTheme.TEXT_MUTED else WidgetTheme.TEXT_SECONDARY)

        val titleColor = when {
            r.isPast -> WidgetTheme.TEXT_MUTED
            r.isCurrent -> WidgetTheme.TEXT_PRIMARY
            else -> WidgetTheme.TEXT_PRIMARY
        }
        v.setTextViewText(R.id.week_task_row_title, t.title)
        v.setTextColor(R.id.week_task_row_title, titleColor)
        v.setTextColor(
            R.id.week_task_row_time,
            if (r.isPast) WidgetTheme.TEXT_DIM else WidgetTheme.TEXT_SECONDARY,
        )

        if (r.isCurrent) {
            v.setViewVisibility(R.id.week_task_row_badge, View.VISIBLE)
            v.setTextViewText(R.id.week_task_row_badge, "NOW")
            v.setTextColor(R.id.week_task_row_badge, WidgetTheme.SUCCESS)
        } else {
            v.setViewVisibility(R.id.week_task_row_badge, View.GONE)
        }
        return v
    }

    private fun inboxRowView(r: TaskListItem.InboxRow): RemoteViews {
        val v = RemoteViews(context.packageName, R.layout.widget_combined_inbox_row)
        v.setOnClickFillInIntent(R.id.row_root, Intent())
        v.setTextViewText(R.id.combined_inbox_row_title, r.task.title)
        v.setTextColor(R.id.combined_inbox_row_title, WidgetTheme.TEXT_PRIMARY)
        v.setImageViewResource(
            R.id.combined_inbox_icon,
            WidgetIconLibrary.iconResFor(r.task.symbol),
        )
        v.setInt(
            R.id.combined_inbox_color,
            "setColorFilter",
            WidgetTheme.parseColor(r.task.color),
        )
        return v
    }

    private fun moreRowView(count: Int): RemoteViews {
        val v = RemoteViews(context.packageName, R.layout.widget_week_more_row)
        v.setOnClickFillInIntent(R.id.row_root, Intent())
        v.setTextViewText(R.id.week_more_row_label, context.getString(R.string.week_more, count))
        return v
    }

    private fun emptyRowView(): RemoteViews {
        val v = RemoteViews(context.packageName, R.layout.widget_week_empty_row)
        v.setOnClickFillInIntent(R.id.row_root, Intent())
        v.setTextViewText(R.id.week_empty_row_label, context.getString(R.string.week_free))
        return v
    }

    private fun statusBannerView(b: TaskListItem.StatusBanner): RemoteViews {
        val v = RemoteViews(context.packageName, R.layout.widget_status_banner_row)
        v.setOnClickFillInIntent(R.id.row_root, Intent())
        v.setTextViewText(R.id.status_banner_text, b.message)
        val icon = when (b.kind) {
            TaskListItem.StatusBanner.Kind.EMPTY -> R.drawable.ic_task_sun
            TaskListItem.StatusBanner.Kind.ERROR -> R.drawable.ic_task_error
            TaskListItem.StatusBanner.Kind.INFO -> R.drawable.ic_task_clock
        }
        v.setImageViewResource(R.id.status_banner_icon, icon)
        return v
    }
}
