package com.example.structuredwidget.data

/** How widget data was sourced — drives status banners. */
enum class WidgetDisplayState {
    LIVE,
    DEMO,
    STALE,
    OFFLINE,
    RELINK,
}
