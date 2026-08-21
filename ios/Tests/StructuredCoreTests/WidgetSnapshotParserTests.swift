import XCTest
import StructuredCore

final class WidgetSnapshotParserTests: XCTestCase {
    func testParseSnapshotExtractsAllSections() throws {
        let json = """
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
        """.data(using: .utf8)!
        let snap = try WidgetSnapshotParser.parse(data: json)
        XCTAssertEqual(snap.logicalDate, DayDate(year: 2026, month: 7, day: 6))
        XCTAssertEqual(snap.timezone, "America/New_York")
        XCTAssertEqual(snap.dayStartsAt, ClockTime(hour: 4, minute: 0))
        XCTAssertEqual(snap.version, "abc123")
        XCTAssertEqual(snap.today.count, 1)
        XCTAssertEqual(snap.today[0].title, "Standup")
        XCTAssertEqual(snap.today[0].startTime ?? -1, 9.0, accuracy: 0.01)
        XCTAssertEqual(snap.inbox.count, 1)
        XCTAssertTrue(snap.inbox[0].isInInbox)
        XCTAssertEqual(snap.due.count, 1)
        XCTAssertEqual(snap.tomorrow.count, 1)
        XCTAssertEqual(snap.week.count, 1)
    }

    func testParseTimelineHandlesFractionalStartTime() {
        let arr: [Any] = [[
            "id": "t1",
            "title": "Task",
            "day": "2026-07-06",
            "start_time": 9.5,
            "duration_minutes": 30,
        ]]
        let tasks = WidgetSnapshotParser.parseTimeline(arr)
        XCTAssertEqual(tasks[0].startTime ?? -1, 9.5, accuracy: 0.01)
    }

    func testUUIDIdIsStringified() {
        let arr: [Any] = [[
            "id": "11111111-1111-1111-1111-111111111111",
            "title": "Task",
        ]]
        let tasks = WidgetSnapshotParser.parseTimeline(arr)
        XCTAssertEqual(tasks[0].id, "11111111-1111-1111-1111-111111111111")
    }

    func testOccurrenceWithoutDayIsNotInbox() {
        let arr: [Any] = [[
            "id": "occ",
            "title": "Recurring",
            "is_occurrence": true,
        ]]
        let tasks = WidgetSnapshotParser.parseTimeline(arr)
        XCTAssertFalse(tasks[0].isInInbox)
    }
}

final class WidgetCacheTests: XCTestCase {
    func testTrySetSkipsIdenticalVersion() {
        let cache = WidgetCache()
        let today = TodayState()
        let week = WeekState(days: [])
        XCTAssertTrue(cache.trySet(
            todayState: today, weekState: week, version: "abc", etag: nil,
            displayState: .live, logicalDate: DayDate.today(), nowMs: 1
        ))
        XCTAssertFalse(cache.trySet(
            todayState: today, weekState: week, version: "abc", etag: nil,
            displayState: .live, logicalDate: DayDate.today(), nowMs: 2
        ))
        XCTAssertTrue(cache.trySet(
            todayState: today, weekState: week, version: "def", etag: nil,
            displayState: .live, logicalDate: DayDate.today(), nowMs: 3
        ))
    }

    func testIsNewerVersionTreatsAnyChangeAsNewer() {
        XCTAssertTrue(WidgetCache.isNewerVersion("def", current: "abc"))
        XCTAssertFalse(WidgetCache.isNewerVersion("abc", current: "abc"))
    }
}

final class BackendFetchErrorTests: XCTestCase {
    func testUnauthorizedIsDistinctFromHttpError() {
        let auth: FetchError = .unauthorized
        let http: FetchError = .http(code: 500, message: "server error")
        XCTAssertEqual(auth, .unauthorized)
        if case .http(let code, _) = http {
            XCTAssertEqual(code, 500)
        } else {
            XCTFail("expected http")
        }
    }
}
