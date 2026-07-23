package com.example.structuredwidget.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews
import com.example.structuredwidget.R
import com.example.structuredwidget.widget.common.WidgetClickHandler

class CombinedWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(context: Context, mgr: AppWidgetManager, ids: IntArray) {
        for (id in ids) {
            mgr.updateAppWidget(id, buildRootViews(context, id))
        }
        // Kick a background refresh so the list isn't empty on first place.
        WidgetRefreshScheduler.schedule(context)
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

internal fun buildRootViews(context: Context, widgetId: Int): RemoteViews {
    val views = RemoteViews(context.packageName, R.layout.widget_combined)

    val serviceIntent = Intent(context, CombinedWidgetService::class.java).apply {
        putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
        data = Uri.parse(toUri(Intent.URI_INTENT_SCHEME))
    }
    views.setRemoteAdapter(R.id.combined_list, serviceIntent)

    WidgetClickHandler.attachOpenAppAndRefresh(
        context,
        views,
        R.id.widget_header,
        R.id.widget_header_title,
        R.id.widget_header_open,
    )
    WidgetClickHandler.setOpenAppAndRefreshTemplate(context, views, R.id.combined_list)

    return views
}
