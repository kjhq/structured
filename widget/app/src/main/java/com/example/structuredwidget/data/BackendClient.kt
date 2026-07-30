package com.example.structuredwidget.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class BackendClient(
    private val credentials: ApiCredentials,
) {
    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()

    data class ProbeResult(
        val ok: Boolean,
        val message: String,
        val httpCode: Int? = null,
    )

    sealed class FetchError {
        data object Unauthorized : FetchError()
        data class Http(val code: Int, val message: String) : FetchError()
        data class Network(val message: String) : FetchError()
    }

    sealed class SnapshotFetchResult {
        data class Ok(val snapshot: WidgetSnapshot, val etag: String?) : SnapshotFetchResult()
        data class NotModified(val etag: String?) : SnapshotFetchResult()
        data class Error(val error: FetchError) : SnapshotFetchResult()
    }

    /** GET /v1/me — validates URL + Discord credentials. */
    suspend fun probeMe(): ProbeResult = withContext(Dispatchers.IO) {
        val base = credentials.getBaseUrl()
        val discordId = credentials.getDiscordId()
        val token = credentials.getWidgetToken()
        if (base.isNullOrBlank() || discordId.isNullOrBlank() || token.isNullOrBlank()) {
            return@withContext ProbeResult(false, "Missing URL, Discord ID, or token")
        }
        val url = "$base/v1/me"
        AppLog.d("GET $url (discord=$discordId)")
        try {
            val request = authRequest(url).get().build()
            client.newCall(request).execute().use { response ->
                val body = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    AppLog.w("GET $url → ${response.code} ${body.take(160)}")
                    return@use ProbeResult(
                        ok = false,
                        message = "HTTP ${response.code}: ${body.take(100).ifBlank { response.message }}",
                        httpCode = response.code,
                    )
                }
                val tz = runCatching { JSONObject(body).optString("timezone") }.getOrNull()
                val msg = if (!tz.isNullOrBlank()) "Authenticated · timezone $tz" else "Authenticated"
                AppLog.i("GET $url → ${response.code} $msg")
                ProbeResult(true, msg, response.code)
            }
        } catch (e: kotlin.coroutines.cancellation.CancellationException) {
            throw e
        } catch (e: Exception) {
            AppLog.e("GET $url failed", e)
            ProbeResult(false, e.message ?: e.javaClass.simpleName)
        }
    }

    /** GET /v1/widget/snapshot — single atomic widget payload. */
    suspend fun fetchSnapshot(ifNoneMatch: String? = null): SnapshotFetchResult =
        withContext(Dispatchers.IO) {
            val base = credentials.getBaseUrl()
                ?: return@withContext SnapshotFetchResult.Error(FetchError.Network("Base URL not set"))
            val discordId = credentials.getDiscordId()
                ?: return@withContext SnapshotFetchResult.Error(FetchError.Network("Discord ID not set"))
            val token = credentials.getWidgetToken()
                ?: return@withContext SnapshotFetchResult.Error(FetchError.Network("Widget token not set"))
            val url = "$base/v1/widget/snapshot"
            AppLog.d("GET $url (discord=$discordId etag=${ifNoneMatch != null})")
            try {
                val builder = authRequest(url).get()
                if (!ifNoneMatch.isNullOrBlank()) {
                    builder.header("If-None-Match", ifNoneMatch)
                }
                client.newCall(builder.build()).execute().use { response ->
                    val etag = response.header("ETag")
                    when {
                        response.code == 304 ->
                            SnapshotFetchResult.NotModified(etag)
                        response.code == 401 -> {
                            AppLog.w("GET $url → 401 unauthorized")
                            SnapshotFetchResult.Error(FetchError.Unauthorized)
                        }
                        !response.isSuccessful -> {
                            val body = response.body?.string().orEmpty()
                            AppLog.w("GET $url → ${response.code} ${body.take(160)}")
                            SnapshotFetchResult.Error(
                                FetchError.Http(
                                    response.code,
                                    body.take(120).ifBlank { response.message },
                                ),
                            )
                        }
                        else -> {
                            val body = response.body?.string().orEmpty()
                            val snapshot = WidgetSnapshotParser.parse(JSONObject(body))
                            AppLog.i(
                                "GET $url → ${response.code} v=${snapshot.version} " +
                                    "logical=${snapshot.logicalDate} etag=$etag",
                            )
                            SnapshotFetchResult.Ok(snapshot, etag)
                        }
                    }
                }
            } catch (e: kotlin.coroutines.cancellation.CancellationException) {
                throw e
            } catch (e: Exception) {
                AppLog.e("GET $url failed", e)
                SnapshotFetchResult.Error(FetchError.Network(e.message ?: e.javaClass.simpleName))
            }
        }

    private fun authRequest(url: String): Request.Builder =
        Request.Builder()
            .url(url)
            .header("Accept", "application/json")
            .header("X-Discord-Id", credentials.getDiscordId().orEmpty())
            .header("X-Widget-Token", credentials.getWidgetToken().orEmpty())
}
