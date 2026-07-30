package com.example.structuredwidget.data

import android.content.Context
import android.content.SharedPreferences

/**
 * Stores backend base URL + Discord ID + widget token.
 * Values are encrypted with Android Keystore AES-GCM after first read/write.
 */
class ApiCredentials(
    context: Context,
    private val encryptor: CredentialCipher = CredentialEncryptor(),
) {
    companion object {
        private const val PREFS = "structured_backend"
        private const val KEY_BASE = "base_url"
        private const val KEY_DISCORD = "discord_id"
        private const val KEY_TOKEN = "widget_token"
        private const val KEY_API_LEGACY = "api_key"
        private const val KEY_ENC_BASE = "enc_base_url"
        private const val KEY_ENC_DISCORD = "enc_discord_id"
        private const val KEY_ENC_TOKEN = "enc_widget_token"
        private const val KEY_MIGRATED = "credentials_encrypted"
        const val DEFAULT_BASE_URL = "http://10.0.2.2:8003" // debug emulator → host :8003; release requires https://…:8443
    }

    private val prefs: SharedPreferences =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    init {
        migratePlaintextIfNeeded()
    }

    fun isConfigured(): Boolean =
        !getDiscordId().isNullOrBlank() &&
            !getWidgetToken().isNullOrBlank() &&
            !getBaseUrl().isNullOrBlank()

    fun getBaseUrl(): String? = readField(KEY_ENC_BASE, KEY_BASE)?.trim()?.trimEnd('/')?.ifBlank { null }

    fun getDiscordId(): String? = readField(KEY_ENC_DISCORD, KEY_DISCORD)?.trim()?.ifBlank { null }

    fun getWidgetToken(): String? = readField(KEY_ENC_TOKEN, KEY_TOKEN)?.trim()?.ifBlank { null }

    fun save(baseUrl: String, discordId: String, widgetToken: String) {
        writeEncrypted(
            baseUrl = baseUrl.trim().trimEnd('/'),
            discordId = discordId.trim(),
            widgetToken = widgetToken.trim(),
        )
        prefs.edit()
            .remove(KEY_BASE)
            .remove(KEY_DISCORD)
            .remove(KEY_TOKEN)
            .remove(KEY_API_LEGACY)
            .putBoolean(KEY_MIGRATED, true)
            .apply()
    }

    fun clear() {
        prefs.edit().clear().apply()
    }

    /** One-time migration from legacy plaintext prefs. */
    internal fun migratePlaintextIfNeeded() {
        if (prefs.getBoolean(KEY_MIGRATED, false)) return
        val base = prefs.getString(KEY_BASE, null)
        val discord = prefs.getString(KEY_DISCORD, null)
        val token = prefs.getString(KEY_TOKEN, null)
        if (base.isNullOrBlank() && discord.isNullOrBlank() && token.isNullOrBlank()) {
            prefs.edit().putBoolean(KEY_MIGRATED, true).apply()
            return
        }
        writeEncrypted(
            baseUrl = base.orEmpty(),
            discordId = discord.orEmpty(),
            widgetToken = token.orEmpty(),
        )
        prefs.edit()
            .remove(KEY_BASE)
            .remove(KEY_DISCORD)
            .remove(KEY_TOKEN)
            .remove(KEY_API_LEGACY)
            .putBoolean(KEY_MIGRATED, true)
            .apply()
        AppLog.i("Credentials migrated to Keystore encryption")
    }

    private fun writeEncrypted(baseUrl: String, discordId: String, widgetToken: String) {
        prefs.edit()
            .putString(KEY_ENC_BASE, encryptor.encrypt(baseUrl))
            .putString(KEY_ENC_DISCORD, encryptor.encrypt(discordId))
            .putString(KEY_ENC_TOKEN, encryptor.encrypt(widgetToken))
            .apply()
    }

    private fun readField(encKey: String, legacyKey: String): String? {
        val enc = prefs.getString(encKey, null)
        if (!enc.isNullOrBlank()) {
            return try {
                encryptor.decrypt(enc)
            } catch (e: Exception) {
                AppLog.e("Failed to decrypt credential field $encKey", e)
                null
            }
        }
        return prefs.getString(legacyKey, null)
    }
}
