package com.example.structuredwidget.widget.common

import java.util.Locale
import kotlin.math.floor

object TimeFormat {
    fun formatHour(hours: Double, use24h: Boolean): String {
        val totalMinutes = floor(hours * 60.0 + 0.5).toInt()
        val h = ((totalMinutes / 60) % 24 + 24) % 24
        val m = ((totalMinutes % 60) + 60) % 60
        return if (use24h) {
            String.format(Locale.US, "%02d:%02d", h, m)
        } else {
            val period = if (h < 12) "a" else "p"
            val displayH = when (h) {
                0 -> 12
                in 13..23 -> h - 12
                else -> h
            }
            if (m == 0) {
                String.format(Locale.US, "%d%s", displayH, period)
            } else {
                String.format(Locale.US, "%d:%02d%s", displayH, m, period)
            }
        }
    }

    fun formatDuration(minutes: Int): String {
        val m = minutes.coerceAtLeast(0)
        if (m < 60) return "${m}m"
        val h = m / 60
        val rem = m % 60
        return if (rem == 0) "${h}h" else "${h}h ${rem}m"
    }

    fun formatRelativeUpdated(ageMs: Long): String {
        val mins = (ageMs / 60_000L).toInt().coerceAtLeast(0)
        return when {
            mins < 1 -> "just now"
            mins == 1 -> "1 min ago"
            mins < 60 -> "$mins min ago"
            else -> {
                val h = mins / 60
                if (h == 1) "1h ago" else "${h}h ago"
            }
        }
    }

    fun hourOfDayFraction(hour: Int, minute: Int): Float {
        val total = hour * 60 + minute
        return (total / (24f * 60f)).coerceIn(0f, 1f)
    }
}
