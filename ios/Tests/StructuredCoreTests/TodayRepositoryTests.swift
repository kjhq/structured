import XCTest
import StructuredCore

final class TodayRepositoryTests: XCTestCase {
    private let today = DayDate(year: 2026, month: 7, day: 6)
    private let now = ClockTime(hour: 10, minute: 0)

    private func task(
        id: String,
        title: String,
        day: String,
        startTime: Double? = nil,
        duration: Int = 0,
        isAllDay: Bool = false,
        completedAt: String? = nil
    ) -> StructuredTask {
        StructuredTask(
            id: id, title: title, day: day, startTime: startTime, duration: duration,
            isAllDay: isAllDay, completedAt: completedAt
        )
    }

    private func snapshot(
        due: [StructuredTask] = [],
        todayTasks: [StructuredTask] = [],
        timezone: String = "America/New_York"
    ) -> WidgetSnapshot {
        WidgetSnapshot(
            logicalDate: today,
            timezone: timezone,
            dayStartsAt: ClockTime(hour: 4, minute: 0),
            generatedAt: "2026-07-06T10:00:00Z",
            version: "1",
            today: todayTasks,
            inbox: [],
            due: due,
            tomorrow: [],
            week: []
        )
    }

    private func repo(_ tz: String = "America/New_York") -> TodayRepository {
        TodayRepository(now: { self.now }, deviceTimeZoneId: { tz })
    }

    func testFromSnapshotSortsDueTasksNewestDayFirst() {
        let snap = snapshot(due: [
            task(id: "d1", title: "Older", day: "2026-07-03", startTime: 9.0),
            task(id: "d2", title: "Yesterday", day: "2026-07-05", startTime: 14.0),
            task(id: "d3", title: "Also yesterday", day: "2026-07-05", startTime: 9.0),
        ])
        let state = repo().fromSnapshot(snap)
        XCTAssertEqual(state.due.map(\.title), ["Also yesterday", "Yesterday", "Older"])
    }

    func testFromSnapshotExcludesCompletedDueTasks() {
        let snap = snapshot(due: [
            task(id: "d1", title: "Done", day: "2026-07-05", completedAt: "2026-07-06T08:00:00Z"),
            task(id: "d2", title: "Still open", day: "2026-07-05"),
        ])
        let state = repo().fromSnapshot(snap)
        XCTAssertEqual(state.due.count, 1)
        XCTAssertEqual(state.due[0].title, "Still open")
    }

    func testFromSnapshotIsNotEmptyWhenOnlyDueTasksExist() {
        let snap = snapshot(due: [task(id: "d1", title: "Overdue", day: "2026-07-05")])
        let state = repo().fromSnapshot(snap)
        XCTAssertFalse(state.isEmpty)
        XCTAssertFalse(state.due.isEmpty)
    }

    func testFromSnapshotUsesLogicalDateFromServer() {
        let state = repo().fromSnapshot(snapshot())
        XCTAssertEqual(state.logicalDate, today)
    }

    func testTimezoneMismatchDetectedWhenDeviceDiffersFromServer() {
        XCTAssertTrue(TodayRepository.isTimezoneMismatch("UTC", device: "America/New_York"))
        XCTAssertFalse(TodayRepository.isTimezoneMismatch("America/New_York", device: "America/New_York"))
        XCTAssertFalse(TodayRepository.isTimezoneMismatch("", device: "UTC"))
    }

    func testHeroIsInProgressTimedTask() {
        let snap = snapshot(todayTasks: [
            task(id: "a", title: "Standup", day: "2026-07-06", startTime: 9.0, duration: 30),
            task(id: "b", title: "Deep work", day: "2026-07-06", startTime: 10.0, duration: 90),
            task(id: "c", title: "Lunch", day: "2026-07-06", startTime: 12.0, duration: 60),
        ])
        let state = repo().fromSnapshot(snap)
        XCTAssertEqual(state.hero?.title, "Deep work")
    }

    func testHeroFallsBackToNextUpcoming() {
        let snap = snapshot(todayTasks: [
            task(id: "a", title: "Morning", day: "2026-07-06", startTime: 7.0, duration: 30),
            task(id: "b", title: "Lunch", day: "2026-07-06", startTime: 12.0, duration: 60),
        ])
        let state = repo().fromSnapshot(snap)
        XCTAssertEqual(state.hero?.title, "Lunch")
    }
}

final class WeekRepositoryTests: XCTestCase {
    func testFromSnapshotGroupsByLogicalDayAndSkipsEmptyOffsets() {
        let today = DayDate(year: 2026, month: 7, day: 6)
        let snap = WidgetSnapshot(
            logicalDate: today,
            timezone: "UTC",
            dayStartsAt: ClockTime(hour: 4, minute: 0),
            generatedAt: "",
            version: "1",
            today: [],
            inbox: [],
            due: [],
            tomorrow: [],
            week: [
                StructuredTask(id: "a", title: "Dinner", day: "2026-07-08", startTime: 19.0, duration: 60),
            ]
        )
        let state = WeekRepository().fromSnapshot(snap)
        XCTAssertEqual(state.days.count, 8)
        let wednesday = state.days.first { $0.date == DayDate(year: 2026, month: 7, day: 8) }
        XCTAssertEqual(wednesday?.timed.count, 1)
        XCTAssertEqual(wednesday?.timed.first?.title, "Dinner")
        XCTAssertTrue(state.days[0].isToday)
    }
}

final class WidgetHeaderTests: XCTestCase {
    func testTodayHeaderCountIncludesHeroAllDayAndUpNext() {
        let state = TodayState(
            allDay: [StructuredTask(id: "a0", title: "A")],
            hero: StructuredTask(id: "hero", title: "H"),
            upNext: [StructuredTask(id: "u0", title: "U"), StructuredTask(id: "u1", title: "U2")],
            isEmpty: false
        )
        XCTAssertEqual(WidgetHeader.todayTaskCount(state), 4)
    }

    func testTodayHeaderCountIsZeroWhenStateIsNil() {
        XCTAssertEqual(WidgetHeader.todayTaskCount(nil), 0)
    }
}
