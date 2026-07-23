package com.example.structuredwidget

import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.workDataOf
import com.example.structuredwidget.data.ApiCredentials
import com.example.structuredwidget.widget.WidgetRefreshScheduler
import com.example.structuredwidget.widget.WidgetRefreshWorker

class MainActivity : AppCompatActivity() {

    private lateinit var credentials: ApiCredentials

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        credentials = ApiCredentials(applicationContext)

        val statusText = findViewById<TextView>(R.id.status_text)
        val authButton = findViewById<Button>(R.id.auth_button)
        val refreshButton = findViewById<Button>(R.id.refresh_button)
        val baseUrlInput = findViewById<EditText>(R.id.base_url_input)
        val discordIdInput = findViewById<EditText>(R.id.discord_id_input)
        val widgetTokenInput = findViewById<EditText>(R.id.widget_token_input)

        baseUrlInput.setText(
            credentials.getBaseUrl() ?: ApiCredentials.DEFAULT_BASE_URL,
        )
        discordIdInput.setText(credentials.getDiscordId().orEmpty())
        widgetTokenInput.setText(credentials.getWidgetToken().orEmpty())

        syncRefreshWork()
        renderStatus(statusText, authButton)

        authButton.setOnClickListener {
            if (credentials.isConfigured()) {
                credentials.clear()
                WidgetRefreshScheduler.cancel(this)
                WidgetRefreshScheduler.schedule(this)
                discordIdInput.setText("")
                widgetTokenInput.setText("")
                renderStatus(statusText, authButton)
                Toast.makeText(this, "Disconnected", Toast.LENGTH_SHORT).show()
            } else {
                val base = baseUrlInput.text?.toString().orEmpty()
                val discordId = discordIdInput.text?.toString().orEmpty()
                val token = widgetTokenInput.text?.toString().orEmpty()
                if (base.isBlank() || discordId.isBlank() || token.isBlank()) {
                    Toast.makeText(
                        this,
                        "Enter base URL, Discord ID, and widget token",
                        Toast.LENGTH_SHORT,
                    ).show()
                    return@setOnClickListener
                }
                credentials.save(base, discordId, token)
                WidgetRefreshScheduler.schedule(this)
                renderStatus(statusText, authButton)
                Toast.makeText(this, "Saved — widgets will refresh every 15 minutes", Toast.LENGTH_LONG)
                    .show()
            }
        }

        refreshButton.setOnClickListener {
            val request = OneTimeWorkRequestBuilder<WidgetRefreshWorker>()
                .setInputData(workDataOf("manual" to true))
                .build()
            WorkManager.getInstance(this).enqueueUniqueWork(
                "widget_refresh_manual",
                ExistingWorkPolicy.REPLACE,
                request,
            )
            Toast.makeText(this, "Refreshing widgets…", Toast.LENGTH_SHORT).show()
        }
    }

    private fun renderStatus(statusText: TextView, authButton: Button) {
        if (credentials.isConfigured()) {
            statusText.text = "Connected to ${credentials.getBaseUrl()}"
            authButton.text = "Disconnect"
        } else {
            statusText.text = "Not connected — paste URL + Discord ID + token from /link"
            authButton.text = "Save & connect"
        }
    }

    private fun syncRefreshWork() {
        WidgetRefreshScheduler.schedule(this)
    }
}
