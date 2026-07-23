package com.example.structuredwidget.widget.common

import com.example.structuredwidget.R

object WidgetIconLibrary {
    private val map: Map<String, Int> = mapOf(
        // SF Symbols used by Structured
        "alarm.fill" to R.drawable.ic_task_alarm,
        "alarm" to R.drawable.ic_task_clock,
        "clock" to R.drawable.ic_task_clock,
        "clock.fill" to R.drawable.ic_task_clock,
        "moon.fill" to R.drawable.ic_task_moon,
        "moon" to R.drawable.ic_task_moon,
        "sun.max.fill" to R.drawable.ic_task_sun,
        "sun.fill" to R.drawable.ic_task_sun,
        "sun" to R.drawable.ic_task_sun,
        "dumbbell.fill" to R.drawable.ic_task_dumbbell,
        "dumbbell" to R.drawable.ic_task_dumbbell,
        "car.fill" to R.drawable.ic_task_car,
        "car" to R.drawable.ic_task_car,
        "bicycle" to R.drawable.ic_task_bicycle,
        "pencil" to R.drawable.ic_task_pencil,
        "pencil.and.outline" to R.drawable.ic_task_pencil,
        "calendar" to R.drawable.ic_task_calendar,
        "calendar.fill" to R.drawable.ic_task_calendar,
        "house.fill" to R.drawable.ic_task_house,
        "house" to R.drawable.ic_task_house,
        "text.badge.checkmark" to R.drawable.ic_task_checkmark,
        "checkmark" to R.drawable.ic_task_checkmark,
        "text.bubble" to R.drawable.ic_task_checkmark,
        "message" to R.drawable.ic_task_checkmark,
        "exclamationmark.triangle" to R.drawable.ic_task_error,
        "error" to R.drawable.ic_task_error,
    )

    fun iconResFor(symbol: String?): Int {
        if (symbol.isNullOrBlank()) return R.drawable.ic_task_default
        return map[symbol] ?: map[symbol.lowercase()] ?: R.drawable.ic_task_default
    }
}
