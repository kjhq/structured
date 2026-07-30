package com.example.structuredwidget.data

import android.content.Context
import com.example.structuredwidget.R
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.CopyOnWriteArrayList

/** Persisted connection / refresh status for the settings screen. */
class ConnectionStatus(context: Context) {
    companion object {
        private const val PREFS = "structured_status"
        private const val KEY_PROBE_OK = "probe_ok"
        private const val KEY_PROBE_MSG = "probe_msg"
        private const val KEY_PROBE_AT = "probe_at"
        private const val KEY_REFRESH_OK = "refresh_ok"
        private const val KEY_REFRESH_MSG = "refresh_msg"
        private const val KEY_REFRESH_AT = "refresh_at"
        private val listeners = CopyOnWriteArrayList<() -> Unit>()

        fun addListener(listener: () -> Unit) {
            listeners.add(listener)
        }

        fun removeListener(listener: () -> Unit) {
            listeners.remove(listener)
        }

        private fun notifyListeners() {
            listeners.forEach { it.invoke() }
        }
    }

    enum class State {
        NOT_CONFIGURED,
        SAVED_UNTESTED,
        OK,
        FAILING,
    }

    data class CheckResult(
        val ok: Boolean,
        val message: String,
        val atEpochMs: Long,
    )

    data class CredentialSummary(
        val baseUrl: String,
        val discordId: String,
        val maskedToken: String,
    )

    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val timeFmt = SimpleDateFormat("MMM d HH:mm:ss", Locale.US)

    fun recordProbe(ok: Boolean, message: String) {
        prefs.edit()
            .putBoolean(KEY_PROBE_OK, ok)
            .putString(KEY_PROBE_MSG, message)
            .putLong(KEY_PROBE_AT, System.currentTimeMillis())
            .apply()
        if (ok) AppLog.i("Probe OK — $message") else AppLog.w("Probe failed — $message")
        notifyListeners()
    }

    fun recordRefresh(ok: Boolean, message: String) {
        prefs.edit()
            .putBoolean(KEY_REFRESH_OK, ok)
            .putString(KEY_REFRESH_MSG, message)
            .putLong(KEY_REFRESH_AT, System.currentTimeMillis())
            .apply()
        if (ok) AppLog.i("Refresh OK — $message") else AppLog.w("Refresh failed — $message")
        notifyListeners()
    }

    /** Clear probe/refresh results after credentials change so UI doesn't show stale OK. */
    fun invalidateAfterCredentialChange() {
        prefs.edit()
            .remove(KEY_PROBE_OK)
            .remove(KEY_PROBE_MSG)
            .remove(KEY_PROBE_AT)
            .remove(KEY_REFRESH_OK)
            .remove(KEY_REFRESH_MSG)
            .remove(KEY_REFRESH_AT)
            .apply()
        AppLog.i("Status cleared — re-test after credential change")
        notifyListeners()
    }

    fun clear() {
        prefs.edit().clear().apply()
        notifyListeners()
    }

    fun state(credentials: ApiCredentials): State {
        if (!credentials.isConfigured()) return State.NOT_CONFIGURED
        val probeAt = prefs.getLong(KEY_PROBE_AT, 0L)
        if (probeAt == 0L) return State.SAVED_UNTESTED
        if (!prefs.getBoolean(KEY_PROBE_OK, false)) return State.FAILING
        val refreshAt = prefs.getLong(KEY_REFRESH_AT, 0L)
        if (refreshAt != 0L && !prefs.getBoolean(KEY_REFRESH_OK, false)) return State.FAILING
        return State.OK
    }

    fun probeResult(): CheckResult? {
        val at = prefs.getLong(KEY_PROBE_AT, 0L)
        if (at == 0L) return null
        return CheckResult(
            ok = prefs.getBoolean(KEY_PROBE_OK, false),
            message = prefs.getString(KEY_PROBE_MSG, "").orEmpty(),
            atEpochMs = at,
        )
    }

    fun refreshResult(): CheckResult? {
        val at = prefs.getLong(KEY_REFRESH_AT, 0L)
        if (at == 0L) return null
        return CheckResult(
            ok = prefs.getBoolean(KEY_REFRESH_OK, false),
            message = prefs.getString(KEY_REFRESH_MSG, "").orEmpty(),
            atEpochMs = at,
        )
    }

    fun credentialSummary(credentials: ApiCredentials): CredentialSummary? {
        if (!credentials.isConfigured()) return null
        val token = credentials.getWidgetToken().orEmpty()
        val masked = if (token.length <= 8) "••••" else "${token.take(6)}…${token.takeLast(4)}"
        return CredentialSummary(
            baseUrl = credentials.getBaseUrl().orEmpty(),
            discordId = credentials.getDiscordId().orEmpty(),
            maskedToken = masked,
        )
    }

    fun stateChipLabel(context: Context, credentials: ApiCredentials): String {
        return when (state(credentials)) {
            State.NOT_CONFIGURED -> context.getString(R.string.status_chip_not_configured)
            State.SAVED_UNTESTED -> context.getString(R.string.status_chip_untested)
            State.OK -> context.getString(R.string.status_chip_ok)
            State.FAILING -> context.getString(R.string.status_chip_failing)
        }
    }

    fun stateChipBackgroundRes(credentials: ApiCredentials): Int {
        return when (state(credentials)) {
            State.NOT_CONFIGURED -> R.color.settings_chip_neutral
            State.SAVED_UNTESTED -> R.color.settings_chip_warn
            State.OK -> R.color.settings_chip_ok
            State.FAILING -> R.color.settings_chip_error
        }
    }

    fun summary(credentials: ApiCredentials): String {
        if (!credentials.isConfigured()) {
            return "Status: NOT CONFIGURED\n" +
                "Paste backend URL, Discord ID, and widget token from Discord /link.\n" +
                "Widgets show sample data until you save."
        }
        val base = credentials.getBaseUrl().orEmpty()
        val discord = credentials.getDiscordId().orEmpty()
        val token = credentials.getWidgetToken().orEmpty()
        val masked = if (token.length <= 8) "••••" else "${token.take(6)}…${token.takeLast(4)}"

        val probeAt = prefs.getLong(KEY_PROBE_AT, 0L)
        val refreshAt = prefs.getLong(KEY_REFRESH_AT, 0L)
        val probeLine = if (probeAt == 0L) {
            "API check: never run — tap Test connection"
        } else {
            val ok = prefs.getBoolean(KEY_PROBE_OK, false)
            val msg = prefs.getString(KEY_PROBE_MSG, "").orEmpty()
            "API check: ${if (ok) "OK" else "FAIL"} · ${fmt(probeAt)}\n  $msg"
        }
        val refreshLine = if (refreshAt == 0L) {
            "Last widget refresh: never"
        } else {
            val ok = prefs.getBoolean(KEY_REFRESH_OK, false)
            val msg = prefs.getString(KEY_REFRESH_MSG, "").orEmpty()
            "Last widget refresh: ${if (ok) "OK" else "FAIL"} · ${fmt(refreshAt)}\n  $msg"
        }

        return buildString {
            appendLine("Status: CREDENTIALS SAVED")
            appendLine("URL: $base")
            appendLine("Discord: $discord")
            appendLine("Token: $masked")
            appendLine()
            appendLine(probeLine)
            appendLine(refreshLine)
            appendLine()
            append("Periodic refresh every 15 minutes when saved.")
        }.trimEnd()
    }

    fun formatTime(epochMs: Long): String = fmt(epochMs)

    private fun fmt(epochMs: Long): String = synchronized(timeFmt) {
        timeFmt.format(Date(epochMs))
    }
}
