package com.example.structuredwidget.widget

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.workDataOf
import com.example.structuredwidget.MainActivity

/** Refresh widgets, then open our settings activity (not Structured.app). */
class RefreshThenLaunchActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val wm = WorkManager.getInstance(this)
        val request = OneTimeWorkRequestBuilder<WidgetRefreshWorker>()
            .setInputData(workDataOf("manual" to true))
            .build()
        wm.enqueueUniqueWork(
            "widget_refresh_manual",
            ExistingWorkPolicy.REPLACE,
            request,
        )
        startActivity(
            Intent(this, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            },
        )
        finish()
    }
}
