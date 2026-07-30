package com.example.structuredwidget.data

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.LocalTime

class TodayRepositoryTest {

    private val today = LocalDate.of(2026, 7, 6)
    private val now = LocalTime.of(10, 0)

    private fun task(
        id: String,
        title: String,
        day: String,
        startTime: Double? = null,
        completedAt: String? = null,
    ) = StructuredTask(
        id, title, day, startTime, 0, false, false,
        "#5E96CB", "", completedAt, null, emptyList(), null,
    )

    private fun snapshot(
        due: List<StructuredTask> = emptyList(),
        todayTasks: List<StructuredTask> = emptyList(),
        timezone: String = "America/New_York",
    ) = WidgetSnapshot(
        logicalDate = today,
        timezone = timezone,
        dayStartsAt = LocalTime.of(4, 0),
        generatedAt = "2026-07-06T10:00:00Z",
        version = "1",
        today = todayTasks,
        inbox = emptyList(),
        due = due,
        tomorrow = emptyList(),
        week = emptyList(),
    )

    @Test
    fun `fromSnapshot sorts due tasks newest day first`() {
        val snap = snapshot(
            due = listOf(
                task("d1", "Older", "2026-07-03", startTime = 9.0),
                task("d2", "Yesterday", "2026-07-05", startTime = 14.0),
                task("d3", "Also yesterday", "2026-07-05", startTime = 9.0),
            ),
        )
        val state = TodayRepository { now }.fromSnapshot(snap)
        assertEquals(listOf("Also yesterday", "Yesterday", "Older"), state.due.map { it.title })
    }

    @Test
    fun `fromSnapshot excludes completed due tasks`() {
        val snap = snapshot(
            due = listOf(
                task("d1", "Done", "2026-07-05", completedAt = "2026-07-06T08:00:00Z"),
                task("d2", "Still open", "2026-07-05"),
            ),
        )
        val state = TodayRepository { now }.fromSnapshot(snap)
        assertEquals(1, state.due.size)
        assertEquals("Still open", state.due.single().title)
    }

    @Test
    fun `fromSnapshot is not empty when only due tasks exist`() {
        val snap = snapshot(due = listOf(task("d1", "Overdue", "2026-07-05")))
        val state = TodayRepository { now }.fromSnapshot(snap)
        assertFalse(state.isEmpty)
        assertTrue(state.due.isNotEmpty())
    }

    @Test
    fun `fromSnapshot uses logical date from server`() {
        val snap = snapshot(timezone = "America/New_York")
        val state = TodayRepository { now }.fromSnapshot(snap)
        assertEquals(today, state.logicalDate)
    }

    @Test
    fun `timezone mismatch detected when device differs from server`() {
        val deviceTz = java.util.TimeZone.getDefault().id
        val other = if (deviceTz == "UTC") "America/New_York" else "UTC"
        assertTrue(TodayRepository.isTimezoneMismatch(other))
        assertFalse(TodayRepository.isTimezoneMismatch(deviceTz))
    }

    @Test
    fun `load sorts due tasks newest day first`() = runBlocking {
        val source = FakeTaskSource(
            openTasks = listOf(
                task("d1", "Older", "2026-07-03", startTime = 9.0),
                task("d2", "Yesterday", "2026-07-05", startTime = 14.0),
                task("d3", "Also yesterday", "2026-07-05", startTime = 9.0),
            ),
        )
        val state = TodayRepository({ now }).load(source, clock = { today })
        assertEquals(listOf("Also yesterday", "Yesterday", "Older"), state.due.map { it.title })
    }

    @Test
    fun `load excludes completed due tasks`() = runBlocking {
        val source = FakeTaskSource(
            openTasks = listOf(
                task("d1", "Done", "2026-07-05", completedAt = "2026-07-06T08:00:00Z"),
                task("d2", "Still open", "2026-07-05"),
            ),
        )
        val state = TodayRepository({ now }).load(source, clock = { today })
        assertEquals(1, state.due.size)
        assertEquals("Still open", state.due.single().title)
    }

    @Test
    fun `load is not empty when only due tasks exist`() = runBlocking {
        val source = FakeTaskSource(
            openTasks = listOf(task("d1", "Overdue", "2026-07-05")),
        )
        val state = TodayRepository({ now }).load(source, clock = { today })
        assertFalse(state.isEmpty)
        assertTrue(state.due.isNotEmpty())
    }
}

private class FakeTaskSource(
    private val openTasks: List<StructuredTask> = emptyList(),
) : StructuredTaskSource {
    override suspend fun fetchOneOffTasks(date: LocalDate): List<StructuredTask> = emptyList()
    override suspend fun fetchRecurringTasks(): List<StructuredTask> = emptyList()
    override suspend fun fetchInboxTasks(): List<StructuredTask> = emptyList()
    override suspend fun fetchForwardTasks(startDate: LocalDate, endDate: LocalDate): List<StructuredTask> = emptyList()
    override suspend fun fetchOpenTasks(): List<StructuredTask> = openTasks
}
