package com.example.structuredwidget.widget

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.workDataOf

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
        val launchIntent = packageManager.getLaunchIntentForPackage("io.unorderly.structured")
            ?: Intent(Intent.ACTION_MAIN).apply {
                setClassName("io.unorderly.structured", "com.structured.MainActivity")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            }
        startActivity(launchIntent)
        finish()
    }
}
