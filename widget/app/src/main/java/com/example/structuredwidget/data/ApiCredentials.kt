package com.example.structuredwidget.data

import android.content.Context
import android.content.SharedPreferences

/**
 * Stores backend base URL + API key (replaces Structured OAuth).
 */
class ApiCredentials(context: Context) {
    companion object {
        private const val PREFS = "structured_backend"
        private const val KEY_BASE = "base_url"
        private const val KEY_API = "api_key"
        const val DEFAULT_BASE_URL = "http://10.0.2.2:8000" // Android emulator → host loopback
    }

    private val prefs: SharedPreferences =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun isConfigured(): Boolean =
        !getApiKey().isNullOrBlank() && !getBaseUrl().isNullOrBlank()

    fun getBaseUrl(): String? =
        prefs.getString(KEY_BASE, null)?.trim()?.trimEnd('/')?.ifBlank { null }

    fun getApiKey(): String? =
        prefs.getString(KEY_API, null)?.trim()?.ifBlank { null }

    fun save(baseUrl: String, apiKey: String) {
        prefs.edit()
            .putString(KEY_BASE, baseUrl.trim().trimEnd('/'))
            .putString(KEY_API, apiKey.trim())
            .apply()
    }

    fun clear() {
        prefs.edit().clear().apply()
    }
}
