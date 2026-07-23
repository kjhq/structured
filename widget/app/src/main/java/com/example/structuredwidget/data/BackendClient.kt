package com.example.structuredwidget.data

import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

private const val TAG = "BackendClient"

class BackendClient(
    private val credentials: ApiCredentials,
) {
    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()

    suspend fun getJsonArray(path: String): JSONArray = withContext(Dispatchers.IO) {
        val base = credentials.getBaseUrl()
            ?: throw IllegalStateException("Base URL not set")
        val discordId = credentials.getDiscordId()
            ?: throw IllegalStateException("Discord ID not set")
        val token = credentials.getWidgetToken()
            ?: throw IllegalStateException("Widget token not set")
        val url = "$base$path"
        val request = Request.Builder()
            .url(url)
            .header("Accept", "application/json")
            .header("X-Discord-Id", discordId)
            .header("X-Widget-Token", token)
            .get()
            .build()
        client.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                Log.w(TAG, "HTTP ${response.code} for $url: ${body.take(200)}")
                throw IllegalStateException("Backend ${response.code}: ${body.take(120)}")
            }
            if (body.isBlank()) return@use JSONArray()
            when {
                body.trimStart().startsWith("[") -> JSONArray(body)
                else -> {
                    val obj = JSONObject(body)
                    obj.optJSONArray("tasks") ?: JSONArray()
                }
            }
        }
    }
}