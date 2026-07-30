package com.example.structuredwidget.widget

import android.appwidget.AppWidgetManager
import android.content.Context

/** Derives compact list mode from widget height (short tiles show less week/tomorrow). */
object WidgetSizeHelper {
    /** Min height in dp below which content is trimmed and header day bar hidden. */
    private const val COMPACT_HEIGHT_DP = 220

    fun updateCompactForWidget(context: Context, widgetId: Int) {
        val mgr = AppWidgetManager.getInstance(context)
        val opts = mgr.getAppWidgetOptions(widgetId)
        val minHeight = opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 250)
        CombinedDataCache.setCompact(widgetId, minHeight < COMPACT_HEIGHT_DP)
    }

    fun isCompact(widgetId: Int): Boolean = CombinedDataCache.isCompact(widgetId)
}
