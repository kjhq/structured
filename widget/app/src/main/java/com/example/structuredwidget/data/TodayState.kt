package com.example.structuredwidget.data

data class TodayState(
    val allDay: List<StructuredTask>,
    val hero: StructuredTask?,
    val upNext: List<StructuredTask>,
    val inbox: List<StructuredTask>,
    val tomorrow: List<StructuredTask>,
    val currentAccent: Int?,
    val isEmpty: Boolean,
)
