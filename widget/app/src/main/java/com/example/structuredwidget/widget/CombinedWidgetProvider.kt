package com.example.structuredwidget.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.text.format.DateFormat
import android.view.View
import android.widget.RemoteViews
import com.example.structuredwidget.R
import com.example.structuredwidget.data.TodayState
import com.example.structuredwidget.widget.common.TimeFormat
import com.example.structuredwidget.widget.common.WidgetClickHandler
import java.time.LocalDate
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.util.Locale

class CombinedWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(context: Context, mgr: AppWidgetManager, ids: IntArray) {
        for (id in ids) {
            WidgetSizeHelper.updateCompactForWidget(context, id)
            mgr.updateAppWidget(id, buildRootViews(context, id))
        }
        WidgetRefreshScheduler.schedule(context)
    }

    override fun onAppWidgetOptionsChanged(
        context: Context,
        mgr: AppWidgetManager,
        widgetId: Int,
        newOptions: android.os.Bundle,
    ) {
        WidgetSizeHelper.updateCompactForWidget(context, widgetId)
        mgr.updateAppWidget(widgetId, buildRootViews(context, widgetId))
        mgr.notifyAppWidgetViewDataChanged(widgetId, R.id.combined_list)
        super.onAppWidgetOptionsChanged(context, mgr, widgetId, newOptions)
    }

    override fun onEnabled(context: Context) {
        super.onEnabled(context)
        WidgetRefreshScheduler.schedule(context)
    }

    override fun onDisabled(context: Context) {
        super.onDisabled(context)
        WidgetRefreshScheduler.cancel(context)
    }
}

internal fun buildRootViews(
    context: Context,
    widgetId: Int,
    todayState: TodayState? = null,
): RemoteViews {
    val views = RemoteViews(context.packageName, R.layout.widget_combined)
    WidgetSizeHelper.updateCompactForWidget(context, widgetId)

    val use24h = DateFormat.is24HourFormat(context)
    val now = LocalTime.now()
    val resolvedToday = todayState ?: CombinedDataCache.getTodayState()
    val logicalDate = resolvedToday?.logicalDate ?: LocalDate.now()
    val dateFmt = DateTimeFormatter.ofPattern("EEE MMM d", Locale.US)
    views.setTextViewText(
        R.id.widget_header_date,
        logicalDate.format(dateFmt).uppercase(Locale.US),
    )

    val taskCount = todayTaskCount(resolvedToday)
    val nowLabel = TimeFormat.formatHour(now.hour + now.minute / 60.0, use24h)
    val meta = buildString {
        if (taskCount > 0) append("$taskCount · ")
        append("NOW $nowLabel")
    }
    views.setTextViewText(R.id.widget_header_meta, meta)

    val dayFraction = TimeFormat.hourOfDayFraction(now.hour, now.minute)
    views.setProgressBar(
        R.id.widget_header_day_progress,
        100,
        (dayFraction * 100).toInt().coerceIn(0, 100),
        false,
    )
    val progressVis = if (WidgetSizeHelper.isCompact(widgetId)) View.GONE else View.VISIBLE
    views.setViewVisibility(R.id.widget_header_day_progress, progressVis)

    val serviceIntent = Intent(context, CombinedWidgetService::class.java).apply {
        putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
        data = Uri.parse(toUri(Intent.URI_INTENT_SCHEME))
    }
    views.setRemoteAdapter(R.id.combined_list, serviceIntent)

    WidgetClickHandler.attachOpenAppAndRefresh(
        context,
        views,
        R.id.widget_header,
        R.id.widget_header_date,
        R.id.widget_header_open,
    )
    WidgetClickHandler.setOpenAppAndRefreshTemplate(context, views, R.id.combined_list)

    return views
}

internal fun todayTaskCount(todayState: TodayState?): Int {
    if (todayState == null) return 0
    val heroExtra = if (todayState.hero != null) 1 else 0
    return todayState.allDay.size + todayState.upNext.size + heroExtra
}
