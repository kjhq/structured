package com.example.structuredwidget.data

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class ApiCredentialsEncryptionTest {

    private lateinit var context: Context
    private val cipher = FakeCredentialCipher()

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        context.getSharedPreferences("structured_backend", Context.MODE_PRIVATE).edit().clear().apply()
    }

    @Test
    fun `save stores encrypted values not plaintext`() {
        val creds = ApiCredentials(context, cipher)
        creds.save("https://api.example.com", "123456789", "wt_secret_token")
        val prefs = context.getSharedPreferences("structured_backend", Context.MODE_PRIVATE)
        assertFalse(prefs.contains("widget_token"))
        assertFalse(prefs.contains("discord_id"))
        assertFalse(prefs.contains("base_url"))
        assertTrue(prefs.contains("enc_widget_token"))
        assertTrue(prefs.getBoolean("credentials_encrypted", false))
    }

    @Test
    fun `round-trip decrypt after save`() {
        val creds = ApiCredentials(context, cipher)
        creds.save("https://api.example.com", "123456789", "wt_secret_token")
        val reloaded = ApiCredentials(context, cipher)
        assertEquals("https://api.example.com", reloaded.getBaseUrl())
        assertEquals("123456789", reloaded.getDiscordId())
        assertEquals("wt_secret_token", reloaded.getWidgetToken())
        assertTrue(reloaded.isConfigured())
    }

    @Test
    fun `migrates legacy plaintext on first access`() {
        val prefs = context.getSharedPreferences("structured_backend", Context.MODE_PRIVATE)
        prefs.edit()
            .putString("base_url", "http://localhost:8003")
            .putString("discord_id", "999")
            .putString("widget_token", "wt_legacy")
            .apply()
        val creds = ApiCredentials(context, cipher)
        assertEquals("wt_legacy", creds.getWidgetToken())
        assertFalse(prefs.contains("widget_token"))
        assertTrue(prefs.getBoolean("credentials_encrypted", false))
    }
}
