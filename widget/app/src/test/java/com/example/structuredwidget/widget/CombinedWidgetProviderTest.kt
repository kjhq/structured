package com.example.structuredwidget.widget

import com.example.structuredwidget.data.TodayState
import org.junit.Assert.assertEquals
import org.junit.Test

class CombinedWidgetProviderTest {

    private fun todayState(
        allDay: Int = 0,
        upNext: Int = 0,
        hasHero: Boolean = false,
    ) = TodayState(
        allDay = List(allDay) { stubTask("a$it") },
        hero = if (hasHero) stubTask("hero") else null,
        upNext = List(upNext) { stubTask("u$it") },
        inbox = emptyList(),
        tomorrow = emptyList(),
        due = emptyList(),
        currentAccent = null,
        isEmpty = false,
    )

    private fun stubTask(id: String) = com.example.structuredwidget.data.StructuredTask(
        id, "Task $id", "2026-07-06", null, 0, false, false,
        "#5E96CB", "", null, null, emptyList(), null,
    )

    @Test
    fun `today header count includes hero allDay and upNext`() {
        val state = todayState(allDay = 1, upNext = 2, hasHero = true)
        assertEquals(4, todayTaskCount(state))
    }

    @Test
    fun `today header count is zero when state is null`() {
        assertEquals(0, todayTaskCount(null))
    }
}
