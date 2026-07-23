package com.example.structuredwidget.widget

import android.app.Activity
import android.os.Bundle
import android.widget.Toast
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.workDataOf

/** Transparent activity that only triggers a manual widget refresh. */
class RefreshOnlyActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val request = OneTimeWorkRequestBuilder<WidgetRefreshWorker>()
            .setInputData(workDataOf("manual" to true))
            .build()
        WorkManager.getInstance(this).enqueueUniqueWork(
            "widget_refresh_manual",
            ExistingWorkPolicy.REPLACE,
            request,
        )
        Toast.makeText(this, "Refreshing…", Toast.LENGTH_SHORT).show()
        finish()
    }
}
