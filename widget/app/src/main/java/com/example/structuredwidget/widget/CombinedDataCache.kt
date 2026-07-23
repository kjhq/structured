package com.example.structuredwidget.widget

import com.example.structuredwidget.data.TaskListItem

object CombinedDataCache {
    @Volatile private var rows: List<TaskListItem> = emptyList()
    @Volatile private var lastUpdate: Long = 0L
    @Volatile private var lastWasManual: Boolean = false

    fun get(): List<TaskListItem> = rows
    fun set(rows: List<TaskListItem>, manual: Boolean = false) {
        this.rows = rows
        lastUpdate = System.currentTimeMillis()
        lastWasManual = manual
    }
    fun age(): Long = if (lastUpdate == 0L) Long.MAX_VALUE else System.currentTimeMillis() - lastUpdate
    fun wasManual(): Boolean = lastWasManual
}
