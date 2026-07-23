package com.example.structuredwidget.data

data class StructuredTask(
    val id: String,
    val title: String,
    val day: String?,
    val startTime: Double?,
    val duration: Int,
    val isAllDay: Boolean,
    val isInInbox: Boolean,
    val color: String,
    val note: String,
    val completedAt: String?,
    val timezone: String?,
    val alerts: List<Alert>,
    val symbol: String?,
)

data class Alert(
    val type: String,
    val offset: Int?,
)
