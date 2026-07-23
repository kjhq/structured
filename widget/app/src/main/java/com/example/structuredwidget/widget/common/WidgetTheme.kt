package com.example.structuredwidget.widget.common

import android.graphics.Color
import android.content.Context

object WidgetTheme {
    const val TEXT_PRIMARY = 0xF2FFFFFF.toInt()
    const val TEXT_SECONDARY = 0x99FFFFFF.toInt()
    const val TEXT_MUTED = 0x66FFFFFF.toInt()
    const val TEXT_DIM = 0x44FFFFFF.toInt()
    const val HAIRLINE = 0x14FFFFFF
    const val DEFAULT_ACCENT = 0xFF5E96CB.toInt()
    const val SUCCESS = 0xFF26DE81.toInt()
    const val WARNING = 0xFFF7B731.toInt()
    const val ERROR = 0xFFEB3B5A.toInt()

    fun textSecondary(@Suppress("UNUSED_PARAMETER") context: Context): Int = TEXT_SECONDARY

    fun defaultAccent(): Int = DEFAULT_ACCENT

    fun parseColor(hex: String?, fallback: Int = DEFAULT_ACCENT): Int {
        if (hex.isNullOrBlank()) return fallback
        return try {
            Color.parseColor(hex)
        } catch (_: Exception) {
            fallback
        }
    }

    /** Soft tint of accent for hero card backgrounds (alpha ~12%). */
    fun softAccent(accent: Int): Int =
        Color.argb(0x1F, Color.red(accent), Color.green(accent), Color.blue(accent))
}
