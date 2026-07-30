package com.example.structuredwidget.widget

import com.example.structuredwidget.data.DayBlock
import com.example.structuredwidget.data.StructuredTask
import com.example.structuredwidget.data.TaskListItem
import com.example.structuredwidget.data.TodayState
import com.example.structuredwidget.data.WeekState
import com.example.structuredwidget.data.WidgetDisplayState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import androidx.test.core.app.ApplicationProvider
import java.time.LocalDate
import java.time.LocalTime

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class CombinedListFactoryTest {

    private val today = LocalDate.of(2026, 7, 6)
    private val noon = LocalTime.of(12, 0)
    private val context = ApplicationProvider.getApplicationContext<android.content.Context>()

    private fun factory(compact: Boolean = false) = CombinedListFactory(
        use24h = false,
        compact = compact,
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
        inbox = emptyList(), tomorrow = emptyList(), due = emptyList(),
        currentAccent = null, isEmpty = true,
    )

    private fun emptyWeek() = WeekState(
        (0..7).map { offset ->
            val d = today.plusDays(offset.toLong())
            DayBlock(d, emptyList(), emptyList(), 0, d == today, false)
        }
    )

    @Test
    fun `demo state shows demo banner`() {
        val rows = factory().toRowList(emptyToday(), emptyWeek(), context, WidgetDisplayState.DEMO)
        val banner = rows.filterIsInstance<TaskListItem.StatusBanner>().first()
        assertTrue(banner.message.contains("Sample"))
    }

    @Test
    fun `relink state shows error banner`() {
        val rows = factory().toRowList(emptyToday(), emptyWeek(), context, WidgetDisplayState.RELINK)
        val banner = rows.filterIsInstance<TaskListItem.StatusBanner>().first()
        assertEquals(TaskListItem.StatusBanner.Kind.ERROR, banner.kind)
    }

    @Test
    fun `offline state shows warning banner`() {
        val rows = factory().toRowList(emptyToday(), emptyWeek(), context, WidgetDisplayState.OFFLINE)
        val banner = rows.filterIsInstance<TaskListItem.StatusBanner>().first()
        assertEquals(TaskListItem.StatusBanner.Kind.WARNING, banner.kind)
    }

    @Test
    fun `timezone mismatch shows warning banner`() {
        val state = emptyToday().copy(timezoneMismatch = true)
        val rows = factory().toRowList(state, emptyWeek(), context, WidgetDisplayState.LIVE, timezoneMismatch = true)
        assertTrue(rows.any {
            it is TaskListItem.StatusBanner && it.kind == TaskListItem.StatusBanner.Kind.WARNING
        })
    }

    @Test
    fun `empty today shows status banner first`() {
        val rows = factory().toRowList(emptyToday(), emptyWeek(), context)
        assertTrue(rows.first() is TaskListItem.StatusBanner)
    }

    @Test
    fun `no day progress row in list`() {
        val rows = factory().toRowList(emptyToday(), emptyWeek(), context)
        assertFalse(rows.any { it::class.simpleName == "DayProgress" })
    }

    @Test
    fun `hero row appears when hero is present`() {
        val state = TodayState(
            allDay = emptyList(),
            hero = task("a", "Lunch", startTime = 12.0, duration = 60),
            upNext = emptyList(),
            inbox = emptyList(), tomorrow = emptyList(), due = emptyList(),
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
    fun `compact mode omits week section`() {
        val state = emptyToday().copy(inbox = listOf(task("i1", "Inbox 1")), isEmpty = false)
        val rows = factory(compact = true).toRowList(state, emptyWeek(), context)
        assertFalse(rows.any { it is TaskListItem.SectionLabel && it.label == "THIS WEEK" })
    }

    @Test
    fun `due section appears first when due tasks exist`() {
        val due = listOf(task("d1", "Overdue", day = "2026-07-05"))
        val state = emptyToday().copy(due = due, isEmpty = false)
        val rows = factory().toRowList(state, emptyWeek(), context)
        assertTrue(rows.first() is TaskListItem.SectionLabel)
        assertEquals("DUE · 1", (rows.first() as TaskListItem.SectionLabel).label)
    }

    @Test
    fun `due tasks preserve newest-first order from state`() {
        val due = listOf(
            task("d2", "Yesterday", day = "2026-07-05"),
            task("d1", "Older", day = "2026-07-03"),
        )
        val state = emptyToday().copy(due = due, isEmpty = false)
        val rows = factory().toRowList(state, emptyWeek(), context)
        val dueRows = rows.filterIsInstance<TaskListItem.DueRow>()
        assertEquals("Yesterday", dueRows[0].task.title)
        assertEquals("Older", dueRows[1].task.title)
    }

    @Test
    fun `due rows use YEST label for yesterday`() {
        val due = listOf(task("d1", "Missed", day = "2026-07-05"))
        val state = emptyToday().copy(due = due, isEmpty = false)
        val rows = factory().toRowList(state, emptyWeek(), context)
        val dueRow = rows.filterIsInstance<TaskListItem.DueRow>().first()
        assertEquals("YEST", dueRow.dayLabel)
    }

    @Test
    fun `due section caps at eight with more row`() {
        val due = (1..10).map { task("d$it", "Due $it", day = "2026-07-05") }
        val state = emptyToday().copy(due = due, isEmpty = false)
        val rows = factory().toRowList(state, emptyWeek(), context)
        assertEquals(8, rows.filterIsInstance<TaskListItem.DueRow>().size)
        assertTrue(rows.any { it is TaskListItem.MoreRow && it.count == 2 })
    }

    @Test
    fun `due section caps at four in compact mode`() {
        val due = (1..6).map { task("d$it", "Due $it", day = "2026-07-05") }
        val state = emptyToday().copy(due = due, isEmpty = false)
        val rows = factory(compact = true).toRowList(state, emptyWeek(), context)
        assertEquals(4, rows.filterIsInstance<TaskListItem.DueRow>().size)
        assertTrue(rows.any { it is TaskListItem.MoreRow && it.count == 2 })
        assertFalse(rows.any { it is TaskListItem.SectionLabel && it.label == "THIS WEEK" })
    }

    @Test
    fun `due-only state has no empty banner`() {
        val due = listOf(task("d1", "Overdue", day = "2026-07-05"))
        val state = TodayState(
            allDay = emptyList(), hero = null, upNext = emptyList(),
            inbox = emptyList(), tomorrow = emptyList(), due = due,
            currentAccent = null, isEmpty = false,
        )
        val rows = factory().toRowList(state, emptyWeek(), context)
        assertFalse(rows.any { it is TaskListItem.StatusBanner })
    }

    @Test
    fun `due rows are distinct from task rows`() {
        val due = listOf(task("d1", "Overdue", day = "2026-07-05"))
        val state = emptyToday().copy(
            due = due,
            hero = task("h1", "Today task", startTime = 14.0, duration = 60),
            isEmpty = false,
        )
        val rows = factory().toRowList(state, emptyWeek(), context)
        assertTrue(rows.any { it is TaskListItem.DueRow })
        assertTrue(rows.any { it is TaskListItem.TaskRow || it is TaskListItem.HeroRow })
        assertFalse(rows.any { it is TaskListItem.TaskRow && it.task.id == "d1" })
    }
}
