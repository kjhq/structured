package com.example.structuredwidget.data

import com.example.structuredwidget.widget.CombinedDataCache
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.LocalDate
import java.time.LocalTime

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class WidgetSnapshotParserTest {

    @Test
    fun `parse snapshot extracts all sections`() {
        val json = JSONObject(
            """
            {
              "logical_date": "2026-07-06",
              "timezone": "America/New_York",
              "day_starts_at": "04:00:00",
              "generated_at": "2026-07-06T10:00:00Z",
              "version": "abc123",
              "today": [{"id":"t1","title":"Standup","day":"2026-07-06","start_time":"09:00:00","duration_minutes":30,"is_all_day":false,"color":"#5e96cb"}],
              "inbox": [{"id":"i1","title":"Inbox item","color":"#5e96cb"}],
              "due": [{"id":"d1","title":"Overdue","day":"2026-07-05","start_time":"14:00:00","duration_minutes":30,"is_all_day":false,"color":"#eb3b5a"}],
              "tomorrow": [{"id":"tm1","title":"Tomorrow task","day":"2026-07-07","start_time":"10:00:00","duration_minutes":60,"is_all_day":false,"color":"#5e96cb"}],
              "week": [{"id":"w1","title":"Week task","day":"2026-07-08","start_time":"19:00:00","duration_minutes":60,"is_all_day":false,"color":"#5e96cb"}]
            }
            """.trimIndent(),
        )
        val snap = WidgetSnapshotParser.parse(json)
        assertEquals(LocalDate.of(2026, 7, 6), snap.logicalDate)
        assertEquals("America/New_York", snap.timezone)
        assertEquals(LocalTime.of(4, 0), snap.dayStartsAt)
        assertEquals("abc123", snap.version)
        assertEquals(1, snap.today.size)
        assertEquals("Standup", snap.today[0].title)
        assertEquals(9.0, snap.today[0].startTime!!, 0.01)
        assertEquals(1, snap.inbox.size)
        assertTrue(snap.inbox[0].isInInbox)
        assertEquals(1, snap.due.size)
        assertEquals(1, snap.tomorrow.size)
        assertEquals(1, snap.week.size)
    }

    @Test
    fun `parse timeline handles fractional start time`() {
        val arr = org.json.JSONArray(
            """[{"id":"t1","title":"Task","day":"2026-07-06","start_time":9.5,"duration_minutes":30}]""",
        )
        val tasks = WidgetSnapshotParser.parseTimeline(arr)
        assertEquals(9.5, tasks[0].startTime!!, 0.01)
    }
}

class CombinedDataCacheTest {

    @Test
    fun `trySet skips identical version`() {
        CombinedDataCache.clear()
        val today = stubToday()
        val week = WeekState(emptyList())
        assertTrue(
            CombinedDataCache.trySet(today, week, "abc", null, WidgetDisplayState.LIVE, LocalDate.now()),
        )
        assertFalse(
            CombinedDataCache.trySet(today, week, "abc", null, WidgetDisplayState.LIVE, LocalDate.now()),
        )
        assertTrue(
            CombinedDataCache.trySet(today, week, "def", null, WidgetDisplayState.LIVE, LocalDate.now()),
        )
    }

    @Test
    fun `isNewerVersion treats any change as newer`() {
        assertTrue(CombinedDataCache.isNewerVersion("def", "abc"))
        assertFalse(CombinedDataCache.isNewerVersion("abc", "abc"))
    }

    private fun stubToday() = TodayState(
        allDay = emptyList(), hero = null, upNext = emptyList(),
        inbox = emptyList(), tomorrow = emptyList(), due = emptyList(),
        currentAccent = null, isEmpty = true,
    )
}

class BackendFetchErrorTest {

    @Test
    fun `unauthorized is distinct from http error`() {
        val auth: BackendClient.FetchError = BackendClient.FetchError.Unauthorized
        val http = BackendClient.FetchError.Http(500, "server error")
        assertTrue(auth is BackendClient.FetchError.Unauthorized)
        assertTrue(http is BackendClient.FetchError.Http)
    }
}
