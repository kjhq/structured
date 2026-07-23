package com.example.structuredwidget.widget.common

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import com.example.structuredwidget.widget.RefreshOnlyActivity
import com.example.structuredwidget.widget.RefreshThenLaunchActivity

object WidgetClickHandler {

    fun attachOpenStructuredApp(context: Context, views: RemoteViews, vararg viewIds: Int) {
        val pi = openAppPendingIntent(context) ?: return
        for (id in viewIds) views.setOnClickPendingIntent(id, pi)
    }

    fun attachRefresh(context: Context, views: RemoteViews, vararg viewIds: Int) {
        val pi = refreshPendingIntent(context) ?: return
        for (id in viewIds) views.setOnClickPendingIntent(id, pi)
    }

    fun setOpenStructuredAppTemplate(context: Context, views: RemoteViews, listViewId: Int) {
        val pi = openAppPendingIntent(context) ?: return
        views.setPendingIntentTemplate(listViewId, pi)
    }

    private fun openAppPendingIntent(context: Context): PendingIntent? {
        val intent = Intent(context, RefreshThenLaunchActivity::class.java)
        return PendingIntent.getActivity(
            context,
            1,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
        )
    }

    private fun refreshPendingIntent(context: Context): PendingIntent? {
        val intent = Intent(context, RefreshOnlyActivity::class.java)
        return PendingIntent.getActivity(
            context,
            2,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
        )
    }
}
