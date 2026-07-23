package com.example.structuredwidget.widget.common

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import com.example.structuredwidget.widget.RefreshOnlyActivity
import com.example.structuredwidget.widget.RefreshThenLaunchActivity

object WidgetClickHandler {

    /** Open our app and force a widget refresh (header / non-collection views). */
    fun attachOpenAppAndRefresh(context: Context, views: RemoteViews, vararg viewIds: Int) {
        val pi = openAppAndRefreshPendingIntent(context, mutable = false) ?: return
        for (id in viewIds) views.setOnClickPendingIntent(id, pi)
    }

    fun attachRefreshOnly(context: Context, views: RemoteViews, vararg viewIds: Int) {
        val pi = refreshPendingIntent(context) ?: return
        for (id in viewIds) views.setOnClickPendingIntent(id, pi)
    }

    /** List/collection rows: fill-in intents merge into this template (must be mutable). */
    fun setOpenAppAndRefreshTemplate(context: Context, views: RemoteViews, listViewId: Int) {
        val pi = openAppAndRefreshPendingIntent(context, mutable = true) ?: return
        views.setPendingIntentTemplate(listViewId, pi)
    }

    private fun openAppAndRefreshPendingIntent(
        context: Context,
        mutable: Boolean,
    ): PendingIntent? {
        val intent = Intent(context, RefreshThenLaunchActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val mutability =
            if (mutable) PendingIntent.FLAG_MUTABLE else PendingIntent.FLAG_IMMUTABLE
        return PendingIntent.getActivity(
            context,
            if (mutable) 11 else 1,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or mutability,
        )
    }

    private fun refreshPendingIntent(context: Context): PendingIntent? {
        val intent = Intent(context, RefreshOnlyActivity::class.java)
        return PendingIntent.getActivity(
            context,
            2,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }
}
