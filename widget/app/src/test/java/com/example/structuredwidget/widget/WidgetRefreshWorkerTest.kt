package com.example.structuredwidget.widget

import com.example.structuredwidget.data.StructuredTask
import com.example.structuredwidget.data.StructuredTaskSource
import com.example.structuredwidget.data.TodayState
import com.example.structuredwidget.data.WeekRepository
import com.example.structuredwidget.data.WeekState
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.LocalDate
import java.time.LocalTime

class WidgetRefreshWorkerTest {

    private val today = LocalDate.of(2026, 7, 6)
    private val now = LocalTime.of(10, 0)

    private fun task(
        id: String, title: String, day: String = "2026-07-06",
        startTime: Double? = null, duration: Int = 0,
        isAllDay: Boolean = false, isInInbox: Boolean = false,
        color: String = "#5E96CB", symbol: String? = null,
    ) = StructuredTask(
        id, title, day, startTime, duration, isAllDay, isInInbox,
        color, "", null, null, emptyList(), symbol,
    )

    @Test
    fun `refresh calls updater for combined widget`() = runBlocking {
        val src = FakeSource()
        val updater = RecordingUpdater()
        WidgetRefreshWorker.refresh(
            source = src, clock = { today }, nowProvider = { now }, updater = updater,
        )
        assertNotNull("updater.updateCombined should have been called", updater.combinedToday)
        assertNotNull("updater.updateCombined should have week state", updater.combinedWeek)
    }

    @Test
    fun `refresh passes Today state built by TodayRepository`() = runBlocking {
        val lunch = task("a", "Lunch", startTime = 12.0, duration = 60)
        val src = FakeSource(oneOffForToday = listOf(lunch))
        val updater = RecordingUpdater()
        WidgetRefreshWorker.refresh(
            source = src, clock = { today }, nowProvider = { now }, updater = updater,
        )
        val state = updater.combinedToday!!
        assertNotNull("Lunch should be the next/hero task", state.hero)
        assertEquals("Lunch", state.hero?.title)
    }

    @Test
    fun `refresh passes Week state built by WeekRepository`() = runBlocking {
        val src = FakeSource(
            forward = listOf(task("a", "Dinner", day = "2026-07-08", startTime = 19.0, duration = 60)),
        )
        val updater = RecordingUpdater()
        WidgetRefreshWorker.refresh(
            source = src, clock = { today }, nowProvider = { now }, updater = updater,
        )
        val state = updater.combinedWeek!!
        assertEquals(8, state.days.size)
        val wednesday = state.days.first { it.date == LocalDate.of(2026, 7, 8) }
        assertEquals(1, wednesday.timed.size)
        assertEquals("Dinner", wednesday.timed[0].title)
    }

    @Test
    fun `refresh uses source for both repos in one call`() = runBlocking {
        val src = FakeSource()
        val updater = RecordingUpdater()
        WidgetRefreshWorker.refresh(
            source = src, clock = { today }, nowProvider = { now }, updater = updater,
        )
        assertNotNull(updater.combinedToday)
        assertNotNull(updater.combinedWeek)
    }

    @Test
    fun `refresh propagates exceptions from source`() = runBlocking {
        val src = ThrowingSource()
        val updater = RecordingUpdater()
        var caught: Throwable? = null
        try {
            WidgetRefreshWorker.refresh(
                source = src, clock = { today }, nowProvider = { now }, updater = updater,
            )
        } catch (e: Throwable) {
            caught = e
        }
        assertNotNull("expected exception to propagate", caught)
    }
}

private class FakeSource(
    val oneOffForToday: List<StructuredTask> = emptyList(),
    val inbox: List<StructuredTask> = emptyList(),
    val forward: List<StructuredTask> = emptyList(),
    val recurring: List<StructuredTask> = emptyList(),
) : StructuredTaskSource {
    override suspend fun fetchOneOffTasks(date: LocalDate): List<StructuredTask> = oneOffForToday
    override suspend fun fetchRecurringTasks(): List<StructuredTask> = recurring
    override suspend fun fetchInboxTasks(): List<StructuredTask> = inbox
    override suspend fun fetchForwardTasks(startDate: LocalDate, endDate: LocalDate): List<StructuredTask> = forward
}

private class ThrowingSource : StructuredTaskSource {
    override suspend fun fetchOneOffTasks(date: LocalDate): List<StructuredTask> {
        throw RuntimeException("network down")
    }
    override suspend fun fetchRecurringTasks(): List<StructuredTask> = emptyList()
    override suspend fun fetchInboxTasks(): List<StructuredTask> = emptyList()
    override suspend fun fetchForwardTasks(startDate: LocalDate, endDate: LocalDate): List<StructuredTask> = emptyList()
}

private class RecordingUpdater : WidgetUpdater {
    var combinedToday: TodayState? = null
    var combinedWeek: WeekState? = null
    override suspend fun updateCombined(todayState: TodayState, weekState: WeekState, showCheckmark: Boolean) {
        combinedToday = todayState
        combinedWeek = weekState
    }
}
