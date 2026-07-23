package com.example.structuredwidget.widget

import android.content.Context
import android.util.Log
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

object WidgetRefreshScheduler {

    fun schedule(context: Context) {
        Log.d("WidgetRefreshSched", "schedule() called")
        val wm = WorkManager.getInstance(context)
        // Network preferred but not required so sample/offline data still loads.
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.NOT_REQUIRED)
            .build()

        val periodic = PeriodicWorkRequestBuilder<WidgetRefreshWorker>(
            WidgetRefreshWorker.PERIODIC_INTERVAL_MIN, TimeUnit.MINUTES,
        )
            .setConstraints(constraints)
            .build()

        wm.enqueueUniquePeriodicWork(
            WidgetRefreshWorker.UNIQUE_PERIODIC_NAME,
            ExistingPeriodicWorkPolicy.UPDATE,
            periodic,
        )

        val oneShot = OneTimeWorkRequestBuilder<WidgetRefreshWorker>()
            .setConstraints(constraints)
            .build()

        wm.enqueueUniqueWork(
            WidgetRefreshWorker.UNIQUE_ONESHOT_NAME,
            ExistingWorkPolicy.REPLACE,
            oneShot,
        )
    }

    fun cancel(context: Context) {
        val wm = WorkManager.getInstance(context)
        wm.cancelUniqueWork(WidgetRefreshWorker.UNIQUE_PERIODIC_NAME)
        wm.cancelUniqueWork(WidgetRefreshWorker.UNIQUE_ONESHOT_NAME)
    }
}
