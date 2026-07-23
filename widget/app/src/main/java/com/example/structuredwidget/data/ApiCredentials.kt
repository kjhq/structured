package com.example.structuredwidget.data

import android.content.Context
import android.content.SharedPreferences

/**
 * Stores backend base URL + Discord ID + widget token.
 */
class ApiCredentials(context: Context) {
    companion object {
        private const val PREFS = "structured_backend"
        private const val KEY_BASE = "base_url"
        private const val KEY_DISCORD = "discord_id"
        private const val KEY_TOKEN = "widget_token"
        private const val KEY_API_LEGACY = "api_key"
        const val DEFAULT_BASE_URL = "http://10.0.2.2:8000" // Android emulator → host loopback
    }

    private val prefs: SharedPreferences =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun isConfigured(): Boolean =
        !getDiscordId().isNullOrBlank() &&
            !getWidgetToken().isNullOrBlank() &&
            !getBaseUrl().isNullOrBlank()

    fun getBaseUrl(): String? =
        prefs.getString(KEY_BASE, null)?.trim()?.trimEnd('/')?.ifBlank { null }

    fun getDiscordId(): String? =
        prefs.getString(KEY_DISCORD, null)?.trim()?.ifBlank { null }

    fun getWidgetToken(): String? =
        prefs.getString(KEY_TOKEN, null)?.trim()?.ifBlank { null }

    fun save(baseUrl: String, discordId: String, widgetToken: String) {
        prefs.edit()
            .putString(KEY_BASE, baseUrl.trim().trimEnd('/'))
            .putString(KEY_DISCORD, discordId.trim())
            .putString(KEY_TOKEN, widgetToken.trim())
            .remove(KEY_API_LEGACY)
            .apply()
    }

    fun clear() {
        prefs.edit().clear().apply()
    }
}
