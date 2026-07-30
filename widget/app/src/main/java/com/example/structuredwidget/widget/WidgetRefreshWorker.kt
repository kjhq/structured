package com.example.structuredwidget.widget

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.text.format.DateFormat
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.example.structuredwidget.R
import com.example.structuredwidget.data.ApiCredentials
import com.example.structuredwidget.data.AppLog
import com.example.structuredwidget.data.BackendClient
import com.example.structuredwidget.data.BackendTaskSource
import com.example.structuredwidget.data.ConnectionStatus
import com.example.structuredwidget.data.StructuredTaskSource
import com.example.structuredwidget.data.TodayRepository
import com.example.structuredwidget.data.TodayState
import com.example.structuredwidget.data.WeekRepository
import com.example.structuredwidget.data.WeekState
import com.example.structuredwidget.data.WidgetDisplayState
import com.example.structuredwidget.data.WidgetSnapshot
import java.time.LocalDate
import java.time.LocalTime

class WidgetRefreshWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val ctx = applicationContext
        val credentials = ApiCredentials(ctx)
        val status = ConnectionStatus(ctx)
        val isManual = inputData.getBoolean("manual", false)
        return try {
            val configured = credentials.isConfigured()
            AppLog.i(
                "Refresh start · manual=$isManual · auth=$configured · url=${credentials.getBaseUrl()}",
            )
            val outcome = if (configured) {
                refreshFromBackend(ctx, isManual)
            } else {
                refreshDemo(ctx, isManual)
            }
            status.recordRefresh(outcome.ok, outcome.message)
            when (outcome) {
                is RefreshOutcome.Success -> Result.success()
                is RefreshOutcome.AuthFailure -> Result.success()
                is RefreshOutcome.TransientFailure -> Result.retry()
            }
        } catch (e: Throwable) {
            AppLog.e("Refresh failed", e)
            status.recordRefresh(false, e.message ?: e.javaClass.simpleName)
            Result.retry()
        }
    }

  companion object {
        const val UNIQUE_PERIODIC_NAME = "widget_refresh_periodic"
        const val UNIQUE_ONESHOT_NAME = "widget_refresh_oneshot"
        const val PERIODIC_INTERVAL_MIN = 15L
        private const val STALE_THRESHOLD_MS = 30 * 60 * 1000L

        sealed class RefreshOutcome {
            abstract val ok: Boolean
            abstract val message: String

            data class Success(override val message: String) : RefreshOutcome() {
                override val ok = true
            }

            data class AuthFailure(override val message: String) : RefreshOutcome() {
                override val ok = false
            }

            data class TransientFailure(override val message: String) : RefreshOutcome() {
                override val ok = false
            }
        }

        suspend fun refreshFromBackend(context: Context, manual: Boolean): RefreshOutcome {
            val client = BackendClient(ApiCredentials(context))
            val source = BackendTaskSource(client)
            val etag = if (manual) null else CombinedDataCache.etag()
            val result = source.fetchSnapshot(etag)

            return when (result) {
                is BackendClient.SnapshotFetchResult.Ok -> {
                    applySnapshot(
                        context = context,
                        snapshot = result.snapshot,
                        etag = result.etag,
                        displayState = WidgetDisplayState.LIVE,
                        manual = manual,
                        force = true,
                    )
                    RefreshOutcome.Success("Snapshot v=${result.snapshot.version} applied")
                }
                is BackendClient.SnapshotFetchResult.NotModified -> {
                    val cached = CombinedDataCache.get()
                    if (cached != null) {
                        val state = staleDisplayState(cached.displayState, cached.fetchedAt)
                        CombinedDataCache.forceSet(
                            todayState = cached.todayState,
                            weekState = cached.weekState,
                            version = cached.version,
                            etag = result.etag ?: cached.etag,
                            displayState = state,
                            logicalDate = cached.logicalDate,
                            manual = manual,
                        )
                        AppWidgetUpdater(context).updateAllWidgets(manual)
                    }
                    RefreshOutcome.Success("Snapshot not modified (304)")
                }
                is BackendClient.SnapshotFetchResult.Error -> when (result.error) {
                    is BackendClient.FetchError.Unauthorized -> {
                        handleAuthFailure(context, manual)
                        RefreshOutcome.AuthFailure("Auth failed — re-link in Discord")
                    }
                    else -> {
                        val kept = handleTransientFailure(context, manual, result.error)
                        if (kept) {
                            RefreshOutcome.Success("Offline — showing cached data")
                        } else {
                            RefreshOutcome.TransientFailure(
                                when (val e = result.error) {
                                    is BackendClient.FetchError.Http -> "HTTP ${e.code}: ${e.message}"
                                    is BackendClient.FetchError.Network -> e.message
                                    else -> "Unknown error"
                                },
                            )
                        }
                    }
                }
            }
        }

        suspend fun refreshDemo(context: Context, manual: Boolean): RefreshOutcome {
            val snapshot = BackendTaskSource.demoSnapshot()
            applySnapshot(
                context = context,
                snapshot = snapshot,
                etag = null,
                displayState = WidgetDisplayState.DEMO,
                manual = manual,
                force = true,
            )
            return RefreshOutcome.Success("Sample data (no credentials)")
        }

        private suspend fun applySnapshot(
            context: Context,
            snapshot: WidgetSnapshot,
            etag: String?,
            displayState: WidgetDisplayState,
            manual: Boolean,
            force: Boolean = false,
        ) {
            val todayRepo = TodayRepository()
            val weekRepo = WeekRepository()
            val todayState = todayRepo.fromSnapshot(snapshot)
            val weekState = weekRepo.fromSnapshot(snapshot)
            if (force) {
                CombinedDataCache.forceSet(
                    todayState = todayState,
                    weekState = weekState,
                    version = snapshot.version,
                    etag = etag,
                    displayState = displayState,
                    logicalDate = snapshot.logicalDate,
                    manual = manual,
                )
            } else {
                CombinedDataCache.trySet(
                    todayState = todayState,
                    weekState = weekState,
                    version = snapshot.version,
                    etag = etag,
                    displayState = displayState,
                    logicalDate = snapshot.logicalDate,
                    manual = manual,
                )
            }
            AppWidgetUpdater(context).updateAllWidgets(manual)
        }

        private suspend fun handleAuthFailure(context: Context, manual: Boolean) {
            val cached = CombinedDataCache.get()
            if (cached != null) {
                CombinedDataCache.forceSet(
                    todayState = cached.todayState,
                    weekState = cached.weekState,
                    version = cached.version,
                    etag = cached.etag,
                    displayState = WidgetDisplayState.RELINK,
                    logicalDate = cached.logicalDate,
                    manual = manual,
                )
            }
            AppWidgetUpdater(context).updateAllWidgets(manual)
        }

        private suspend fun handleTransientFailure(
            context: Context,
            manual: Boolean,
            error: BackendClient.FetchError,
        ): Boolean {
            val cached = CombinedDataCache.get()
            if (cached == null) return false
            CombinedDataCache.forceSet(
                todayState = cached.todayState,
                weekState = cached.weekState,
                version = cached.version,
                etag = cached.etag,
                displayState = WidgetDisplayState.OFFLINE,
                logicalDate = cached.logicalDate,
                manual = manual,
            )
            AppWidgetUpdater(context).updateAllWidgets(manual)
            AppLog.w("Transient fetch error, showing cache: $error")
            return true
        }

        private fun staleDisplayState(current: WidgetDisplayState, fetchedAt: Long): WidgetDisplayState {
            if (current == WidgetDisplayState.DEMO || current == WidgetDisplayState.RELINK) return current
            val age = System.currentTimeMillis() - fetchedAt
            return if (age > STALE_THRESHOLD_MS) WidgetDisplayState.STALE else current
        }

        /** Legacy path for unit tests using [StructuredTaskSource]. */
        suspend fun refresh(
            source: StructuredTaskSource,
            clock: () -> LocalDate,
            nowProvider: () -> LocalTime,
            updater: WidgetUpdater,
            showCheckmark: Boolean = false,
        ) {
            val todayState = TodayRepository(nowProvider).load(source, clock)
            val weekState = WeekRepository().load(source, clock)
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
        updateAllWidgets(showCheckmark)
    }

    suspend fun updateAllWidgets(showCheckmark: Boolean = false) {
        val cache = CombinedDataCache.get() ?: return
        val component = ComponentName(context, CombinedWidgetProvider::class.java)
        val ids = mgr.getAppWidgetIds(component)
        AppLog.d("updateAllWidgets · widgetIds=${ids.toList()} v=${cache.version}")
        for (id in ids) {
            mgr.updateAppWidget(id, buildRootViews(context, id, cache.todayState))
            mgr.notifyAppWidgetViewDataChanged(id, R.id.combined_list)
        }
    }
}
