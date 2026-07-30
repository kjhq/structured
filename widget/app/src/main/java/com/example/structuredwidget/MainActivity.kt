package com.example.structuredwidget

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Bundle
import android.view.View
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.workDataOf
import com.example.structuredwidget.data.ApiCredentials
import com.example.structuredwidget.data.AppLog
import com.example.structuredwidget.data.BackendClient
import com.example.structuredwidget.data.ConnectionStatus
import com.example.structuredwidget.widget.WidgetRefreshScheduler
import com.example.structuredwidget.widget.WidgetRefreshWorker
import com.google.android.material.button.MaterialButton
import com.google.android.material.textfield.TextInputEditText
import android.widget.TextView
import kotlinx.coroutines.launch
import kotlin.coroutines.cancellation.CancellationException

class MainActivity : AppCompatActivity() {

    private lateinit var credentials: ApiCredentials
    private lateinit var statusStore: ConnectionStatus
    private lateinit var statusChip: TextView
    private lateinit var statusRowUrl: TextView
    private lateinit var statusRowDiscord: TextView
    private lateinit var statusRowToken: TextView
    private lateinit var statusRowProbe: TextView
    private lateinit var statusRowRefresh: TextView
    private lateinit var logText: TextView
    private lateinit var logScroll: View
    private var logExpanded = true
    private val logListener = { runOnUiThread { renderLog() } }
    private val statusListener = { runOnUiThread { renderStatus() } }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        credentials = ApiCredentials(applicationContext)
        statusStore = ConnectionStatus(applicationContext)

        statusChip = findViewById(R.id.status_chip)
        statusRowUrl = findViewById(R.id.status_row_url)
        statusRowDiscord = findViewById(R.id.status_row_discord)
        statusRowToken = findViewById(R.id.status_row_token)
        statusRowProbe = findViewById(R.id.status_row_probe)
        statusRowRefresh = findViewById(R.id.status_row_refresh)
        logText = findViewById(R.id.log_text)
        logScroll = findViewById(R.id.log_scroll)

        val saveButton = findViewById<MaterialButton>(R.id.save_button)
        val testButton = findViewById<MaterialButton>(R.id.test_button)
        val refreshButton = findViewById<MaterialButton>(R.id.refresh_button)
        val disconnectButton = findViewById<MaterialButton>(R.id.disconnect_button)
        val copyLogButton = findViewById<MaterialButton>(R.id.copy_log_button)
        val toggleLogButton = findViewById<MaterialButton>(R.id.toggle_log_button)
        val baseUrlInput = findViewById<TextInputEditText>(R.id.base_url_input)
        val discordIdInput = findViewById<TextInputEditText>(R.id.discord_id_input)
        val widgetTokenInput = findViewById<TextInputEditText>(R.id.widget_token_input)

        baseUrlInput.setText(
            credentials.getBaseUrl() ?: ApiCredentials.DEFAULT_BASE_URL,
        )
        discordIdInput.setText(credentials.getDiscordId().orEmpty())
        widgetTokenInput.setText(credentials.getWidgetToken().orEmpty())

        AppLog.i("Settings opened · configured=${credentials.isConfigured()}")
        WidgetRefreshScheduler.schedule(this)
        renderStatus()
        renderLog()

        saveButton.setOnClickListener {
            val base = baseUrlInput.text?.toString().orEmpty()
            val discordId = discordIdInput.text?.toString().orEmpty()
            val token = widgetTokenInput.text?.toString().orEmpty()
            if (base.isBlank() || discordId.isBlank() || token.isBlank()) {
                Toast.makeText(this, "Fill URL, Discord ID, and token", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            credentials.save(base, discordId, token)
            statusStore.invalidateAfterCredentialChange()
            AppLog.i("Credentials saved · url=${credentials.getBaseUrl()} discord=$discordId")
            WidgetRefreshScheduler.schedule(this)
            renderStatus()
            Toast.makeText(this, "Saved — tap Test connection to verify", Toast.LENGTH_SHORT).show()
        }

        testButton.setOnClickListener {
            val base = baseUrlInput.text?.toString().orEmpty()
            val discordId = discordIdInput.text?.toString().orEmpty()
            val token = widgetTokenInput.text?.toString().orEmpty()
            if (base.isBlank() || discordId.isBlank() || token.isBlank()) {
                Toast.makeText(this, "Fill URL, Discord ID, and token first", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            credentials.save(base, discordId, token)
            statusStore.invalidateAfterCredentialChange()
            testButton.isEnabled = false
            testButton.text = "Testing…"
            AppLog.i("Testing connection…")
            lifecycleScope.launch {
                try {
                    val result = BackendClient(credentials).probeMe()
                    statusStore.recordProbe(result.ok, result.message)
                    Toast.makeText(
                        this@MainActivity,
                        if (result.ok) result.message else "Failed: ${result.message}",
                        Toast.LENGTH_LONG,
                    ).show()
                    if (result.ok) {
                        enqueueRefresh()
                    }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    AppLog.e("Test connection crashed", e)
                    statusStore.recordProbe(false, e.message ?: e.javaClass.simpleName)
                    Toast.makeText(this@MainActivity, "Failed: ${e.message}", Toast.LENGTH_LONG).show()
                } finally {
                    testButton.isEnabled = true
                    testButton.text = getString(R.string.action_test)
                    renderStatus()
                }
            }
        }

        refreshButton.setOnClickListener {
            if (!credentials.isConfigured()) {
                Toast.makeText(this, "Save credentials first", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            enqueueRefresh()
            Toast.makeText(this, "Refreshing widgets…", Toast.LENGTH_SHORT).show()
        }

        disconnectButton.setOnClickListener {
            credentials.clear()
            statusStore.clear()
            WidgetRefreshScheduler.cancel(this)
            WidgetRefreshScheduler.schedule(this)
            discordIdInput.setText("")
            widgetTokenInput.setText("")
            AppLog.w("Credentials cleared — widgets will use sample data")
            renderStatus()
            Toast.makeText(this, "Credentials cleared", Toast.LENGTH_SHORT).show()
        }

        copyLogButton.setOnClickListener {
            val snap = AppLog.snapshot()
            if (snap.isBlank()) {
                Toast.makeText(this, "Log is empty", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            clipboard.setPrimaryClip(ClipData.newPlainText("Structured Widget log", snap))
            Toast.makeText(this, "Log copied", Toast.LENGTH_SHORT).show()
        }

        toggleLogButton.setOnClickListener {
            logExpanded = !logExpanded
            logScroll.visibility = if (logExpanded) View.VISIBLE else View.GONE
            toggleLogButton.text = getString(
                if (logExpanded) R.string.action_hide_log else R.string.action_show_log,
            )
        }
    }

    override fun onStart() {
        super.onStart()
        AppLog.addListener(logListener)
        ConnectionStatus.addListener(statusListener)
        renderStatus()
        renderLog()
    }

    override fun onStop() {
        AppLog.removeListener(logListener)
        ConnectionStatus.removeListener(statusListener)
        super.onStop()
    }

    private fun enqueueRefresh() {
        AppLog.i("Manual widget refresh enqueued")
        val request = OneTimeWorkRequestBuilder<WidgetRefreshWorker>()
            .setInputData(workDataOf("manual" to true))
            .build()
        WorkManager.getInstance(this).enqueueUniqueWork(
            "widget_refresh_manual",
            ExistingWorkPolicy.REPLACE,
            request,
        )
    }

    private fun renderStatus() {
        statusChip.text = statusStore.stateChipLabel(this, credentials)
        val bg = ContextCompat.getColor(this, statusStore.stateChipBackgroundRes(credentials))
        statusChip.background = roundedChipDrawable(bg)

        val creds = statusStore.credentialSummary(credentials)
        if (creds == null) {
            statusRowUrl.visibility = View.GONE
            statusRowDiscord.visibility = View.GONE
            statusRowToken.visibility = View.GONE
        } else {
            statusRowUrl.visibility = View.VISIBLE
            statusRowDiscord.visibility = View.VISIBLE
            statusRowToken.visibility = View.VISIBLE
            statusRowUrl.text = "URL · ${creds.baseUrl}"
            statusRowDiscord.text = "Discord · ${creds.discordId}"
            statusRowToken.text = "Token · ${creds.maskedToken}"
        }

        val probe = statusStore.probeResult()
        statusRowProbe.text = if (probe == null) {
            "API check · never run"
        } else {
            val mark = if (probe.ok) "OK" else "FAIL"
            "API check · $mark · ${statusStore.formatTime(probe.atEpochMs)}\n${probe.message}"
        }

        val refresh = statusStore.refreshResult()
        statusRowRefresh.text = if (refresh == null) {
            "Widget refresh · never"
        } else {
            val mark = if (refresh.ok) "OK" else "FAIL"
            "Widget refresh · $mark · ${statusStore.formatTime(refresh.atEpochMs)}\n${refresh.message}"
        }
    }

    private fun roundedChipDrawable(color: Int): android.graphics.drawable.GradientDrawable {
        return android.graphics.drawable.GradientDrawable().apply {
            setColor(color)
            cornerRadius = resources.getDimension(R.dimen.radius_chip)
        }
    }

    private fun renderLog() {
        val snap = AppLog.snapshot()
        logText.text = snap.ifBlank { "(no log lines yet)" }
    }
}
