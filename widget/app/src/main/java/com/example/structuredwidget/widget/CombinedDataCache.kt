package com.example.structuredwidget.widget

import com.example.structuredwidget.data.TodayState
import com.example.structuredwidget.data.WeekState
import com.example.structuredwidget.data.WidgetDisplayState
import java.time.LocalDate

data class WidgetCacheEntry(
    val todayState: TodayState,
    val weekState: WeekState,
    val version: String,
    val etag: String?,
    val displayState: WidgetDisplayState,
    val logicalDate: LocalDate?,
    val fetchedAt: Long,
)

object CombinedDataCache {
    @Volatile private var entry: WidgetCacheEntry? = null
    @Volatile private var lastWasManual: Boolean = false
    private val compactByWidgetId = mutableMapOf<Int, Boolean>()

    fun get(): WidgetCacheEntry? = entry

    fun getTodayState(): TodayState? = entry?.todayState
    fun getWeekState(): WeekState? = entry?.weekState
    fun displayState(): WidgetDisplayState = entry?.displayState ?: WidgetDisplayState.DEMO
    fun version(): String? = entry?.version
    fun etag(): String? = entry?.etag
    fun age(): Long {
        val fetched = entry?.fetchedAt ?: return Long.MAX_VALUE
        return System.currentTimeMillis() - fetched
    }
    fun wasManual(): Boolean = lastWasManual

    /**
     * Versioned write — only replaces cache when [version] is newer than current.
     * Returns true if cache was updated.
     */
    fun trySet(
        todayState: TodayState,
        weekState: WeekState,
        version: String,
        etag: String?,
        displayState: WidgetDisplayState,
        logicalDate: LocalDate?,
        manual: Boolean = false,
    ): Boolean {
        val current = entry
        if (current != null && version == current.version) {
            return false
        }
        entry = WidgetCacheEntry(
            todayState = todayState,
            weekState = weekState,
            version = version,
            etag = etag,
            displayState = displayState,
            logicalDate = logicalDate,
            fetchedAt = System.currentTimeMillis(),
        )
        lastWasManual = manual
        return true
    }

    /** Force-set for demo/offline states when version comparison should not block. */
    fun forceSet(
        todayState: TodayState,
        weekState: WeekState,
        version: String,
        etag: String?,
        displayState: WidgetDisplayState,
        logicalDate: LocalDate?,
        manual: Boolean = false,
    ) {
        entry = WidgetCacheEntry(
            todayState = todayState,
            weekState = weekState,
            version = version,
            etag = etag,
            displayState = displayState,
            logicalDate = logicalDate,
            fetchedAt = System.currentTimeMillis(),
        )
        lastWasManual = manual
    }

    fun setCompact(widgetId: Int, compact: Boolean) {
        synchronized(compactByWidgetId) {
            compactByWidgetId[widgetId] = compact
        }
    }

    fun isCompact(widgetId: Int): Boolean =
        synchronized(compactByWidgetId) {
            compactByWidgetId[widgetId] ?: false
        }

    fun clear() {
        entry = null
        synchronized(compactByWidgetId) {
            compactByWidgetId.clear()
        }
    }

    internal fun isNewerVersion(incoming: String, current: String): Boolean =
        incoming != current
}
