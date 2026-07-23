package com.example.structuredwidget.widget

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.text.format.DateFormat
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.example.structuredwidget.R
import com.example.structuredwidget.data.ApiCredentials
import com.example.structuredwidget.data.BackendClient
import com.example.structuredwidget.data.BackendTaskSource
import com.example.structuredwidget.data.SampleDataSource
import com.example.structuredwidget.data.StructuredTaskSource
import com.example.structuredwidget.data.TodayRepository
import com.example.structuredwidget.data.TodayState
import com.example.structuredwidget.data.WeekRepository
import com.example.structuredwidget.data.WeekState
import java.time.LocalDate
import java.time.LocalTime

private const val TAG = "WidgetRefreshWorker"

class WidgetRefreshWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        return try {
            val ctx = applicationContext
            val credentials = ApiCredentials(ctx)
            val source: StructuredTaskSource = if (credentials.isConfigured()) {
                BackendTaskSource(BackendClient(credentials))
            } else {
                SampleDataSource
            }
            val isManual = inputData.getBoolean("manual", false)
            Log.d(TAG, "doWork: starting manual=$isManual auth=${credentials.isConfigured()}")
            refresh(
                source = source,
                clock = { LocalDate.now() },
                nowProvider = { LocalTime.now() },
                updater = AppWidgetUpdater(ctx),
                showCheckmark = isManual,
            )
            Log.d(TAG, "doWork: success")
            Result.success()
        } catch (e: Throwable) {
            Log.e(TAG, "doWork failed", e)
            Result.retry()
        }
    }

    companion object {
        const val UNIQUE_PERIODIC_NAME = "widget_refresh_periodic"
        const val UNIQUE_ONESHOT_NAME = "widget_refresh_oneshot"
        const val PERIODIC_INTERVAL_MIN = 15L

        suspend fun refresh(
            source: StructuredTaskSource,
            clock: () -> LocalDate,
            nowProvider: () -> LocalTime,
            updater: WidgetUpdater,
            showCheckmark: Boolean = false,
        ) {
            val todayState = TodayRepository(source, clock, nowProvider).load()
            val weekState = WeekRepository(source, clock).load()
            updater.updateCombined(todayState, weekState, showCheckmark)
        }
    }
}

interface WidgetUpdater {
    suspend fun updateCombined(
        todayState: TodayState,
        weekState: WeekState,
        showCheckmark: Boolean = false,
    )
}

class AppWidgetUpdater(private val context: Context) : WidgetUpdater {

    private val mgr: AppWidgetManager = AppWidgetManager.getInstance(context)

    override suspend fun updateCombined(
        todayState: TodayState,
        weekState: WeekState,
        showCheckmark: Boolean,
    ) {
        val use24h = DateFormat.is24HourFormat(context)
        val rows = CombinedListFactory(use24h = use24h)
            .toRowList(todayState, weekState, context)
        val rowTypes = rows.groupBy { it::class.simpleName }.mapValues { it.value.size }
        Log.d(TAG, "updateCombined: rows=${rows.size} types=$rowTypes showCheck=$showCheckmark")
        CombinedDataCache.set(rows, manual = showCheckmark)

        val component = ComponentName(context, CombinedWidgetProvider::class.java)
        val ids = mgr.getAppWidgetIds(component)
        Log.d(TAG, "updateCombined: widgetIds=${ids.toList()}")
        for (id in ids) {
            // Rebuild root then notify list.
            mgr.updateAppWidget(id, buildRootViews(context, id))
            mgr.notifyAppWidgetViewDataChanged(id, R.id.combined_list)
        }
    }
}
