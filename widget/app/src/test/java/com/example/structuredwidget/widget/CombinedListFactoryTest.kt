package com.example.structuredwidget.widget

import com.example.structuredwidget.data.DayBlock
import com.example.structuredwidget.data.StructuredTask
import com.example.structuredwidget.data.TaskListItem
import com.example.structuredwidget.data.TodayState
import com.example.structuredwidget.data.WeekState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.time.LocalDate
import java.time.LocalTime

@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE)
class CombinedListFactoryTest {

    private val today = LocalDate.of(2026, 7, 6)
    private val noon = LocalTime.of(12, 0)
    private val context = RuntimeEnvironment.getApplication()

    private fun factory() = CombinedListFactory(
        use24h = false,
        clock = { today },
        nowProvider = { noon },
    )

    private fun task(
        id: String, title: String, day: String = "2026-07-06",
        startTime: Double? = null, duration: Int = 0,
        isAllDay: Boolean = false, color: String = "#5E96CB",
        symbol: String? = null,
    ) = StructuredTask(
        id, title, day, startTime, duration, isAllDay, false,
        color, "", null, null, emptyList(), symbol,
    )

    private fun emptyToday() = TodayState(
        allDay = emptyList(), hero = null, upNext = emptyList(),
        inbox = emptyList(), tomorrow = emptyList(),
        currentAccent = null, isEmpty = true,
    )

    private fun emptyWeek() = WeekState(
        (0..7).map { offset ->
            val d = today.plusDays(offset.toLong())
            DayBlock(d, emptyList(), emptyList(), 0, d == today, false)
        }
    )

    @Test
    fun `today header is first row`() {
        val rows = factory().toRowList(emptyToday(), emptyWeek(), context)
        assertTrue(rows.first() is TaskListItem.DayHeader)
        val header = rows.first() as TaskListItem.DayHeader
        assertTrue(header.label.startsWith("●  TODAY"))
    }

    @Test
    fun `day progress ribbon follows today header`() {
        val rows = factory().toRowList(emptyToday(), emptyWeek(), context)
        assertTrue(rows[1] is TaskListItem.DayProgress)
        val progress = rows[1] as TaskListItem.DayProgress
        assertTrue(progress.progress in 0f..1f)
    }

    @Test
    fun `hero row appears when hero is present`() {
        val state = TodayState(
            allDay = emptyList(),
            hero = task("a", "Lunch", startTime = 12.0, duration = 60),
            upNext = emptyList(),
            inbox = emptyList(), tomorrow = emptyList(),
            currentAccent = 0xFFFF5E96.toInt(), isEmpty = false,
        )
        val rows = factory().toRowList(state, emptyWeek(), context)
        val hero = rows.filterIsInstance<TaskListItem.HeroRow>().first()
        assertEquals("Lunch", hero.task.title)
        assertTrue(hero.statusLabel.isNotBlank())
    }

    @Test
    fun `inbox items appear with overflow more-row`() {
        val inbox = (1..10).map { task("i$it", "Task $it") }
        val state = emptyToday().copy(inbox = inbox, isEmpty = false)
        val rows = factory().toRowList(state, emptyWeek(), context)
        val inboxRows = rows.filterIsInstance<TaskListItem.InboxRow>()
        assertEquals(8, inboxRows.size)
        assertTrue(rows.any { it is TaskListItem.MoreRow && it.count == 2 })
    }

    @Test
    fun `section labels appear for inbox and week`() {
        val state = emptyToday().copy(inbox = listOf(task("i1", "Inbox 1")), isEmpty = false)
        val rows = factory().toRowList(state, emptyWeek(), context)
        val labels = rows.filterIsInstance<TaskListItem.SectionLabel>().map { it.label }
        assertTrue(labels.any { it.startsWith("INBOX") })
        assertTrue(labels.any { it == "THIS WEEK" })
    }

    @Test
    fun `today is skipped in week section`() {
        val rows = factory().toRowList(emptyToday(), emptyWeek(), context)
        val weekLabel = rows.indexOfFirst { it is TaskListItem.SectionLabel && it.label == "THIS WEEK" }
        val afterWeek = rows.drop(weekLabel).filterIsInstance<TaskListItem.DayHeader>()
        assertFalse(afterWeek.any { it.date == today })
    }

    @Test
    fun `all-day tasks appear in today section`() {
        val allDayTask = task("a", "All day", isAllDay = true)
        val state = emptyToday().copy(allDay = listOf(allDayTask), hero = null, isEmpty = false)
        val rows = factory().toRowList(state, emptyWeek(), context)
        assertTrue(rows.any { it is TaskListItem.TaskRow && it.task.title == "All day" })
    }

    @Test
    fun `empty days show Free row`() {
        val rows = factory().toRowList(emptyToday(), emptyWeek(), context)
        val freeCount = rows.count { it is TaskListItem.EmptyDay }
        assertTrue(freeCount > 0)
    }

    @Test
    fun `empty today shows status banner`() {
        val rows = factory().toRowList(emptyToday(), emptyWeek(), context)
        assertTrue(rows.any { it is TaskListItem.StatusBanner })
    }
}
