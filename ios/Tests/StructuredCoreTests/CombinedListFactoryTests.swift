import XCTest
import StructuredCore

final class CombinedListFactoryTests: XCTestCase {
    private let today = DayDate(year: 2026, month: 7, day: 6)
    private let noon = ClockTime(hour: 12, minute: 0)

    private func factory(compact: Bool = false) -> CombinedListFactory {
        CombinedListFactory(
            use24h: false,
            compact: compact,
            clock: { self.today },
            now: { self.noon }
        )
    }

    private func task(
        id: String,
        title: String,
        day: String = "2026-07-06",
        startTime: Double? = nil,
        duration: Int = 0,
        isAllDay: Bool = false
    ) -> StructuredTask {
        StructuredTask(
            id: id, title: title, day: day, startTime: startTime,
            duration: duration, isAllDay: isAllDay
        )
    }

    private func emptyToday() -> TodayState {
        TodayState(isEmpty: true)
    }

    private func emptyWeek() -> WeekState {
        WeekState(days: (0...7).map { offset in
            let d = today.adding(days: offset)
            return DayBlock(
                date: d, timed: [], allDay: [], totalTasks: 0,
                isToday: d == today, isYesterday: false
            )
        })
    }

    private func banners(_ rows: [TaskListItem]) -> [(String, TaskListItem.BannerKind)] {
        rows.compactMap {
            if case .statusBanner(let message, let kind) = $0 { return (message, kind) }
            return nil
        }
    }

    func testDemoStateShowsDemoBanner() {
        let rows = factory().toRowList(todayState: emptyToday(), weekState: emptyWeek(), displayState: .demo)
        XCTAssertTrue(banners(rows).first?.0.contains("Sample") == true)
    }

    func testRelinkStateShowsErrorBanner() {
        let rows = factory().toRowList(todayState: emptyToday(), weekState: emptyWeek(), displayState: .relink)
        XCTAssertEqual(banners(rows).first?.1, .error)
    }

    func testOfflineStateShowsWarningBanner() {
        let rows = factory().toRowList(todayState: emptyToday(), weekState: emptyWeek(), displayState: .offline)
        XCTAssertEqual(banners(rows).first?.1, .warning)
    }

    func testTimezoneMismatchShowsWarningBanner() {
        var state = emptyToday()
        state.timezoneMismatch = true
        let rows = factory().toRowList(
            todayState: state, weekState: emptyWeek(),
            displayState: .live, timezoneMismatch: true
        )
        XCTAssertTrue(banners(rows).contains { $0.1 == .warning })
    }

    func testEmptyTodayShowsStatusBannerFirst() {
        let rows = factory().toRowList(todayState: emptyToday(), weekState: emptyWeek())
        if case .statusBanner = rows.first {
            // ok
        } else {
            XCTFail("expected status banner first, got \(String(describing: rows.first))")
        }
    }

    func testHeroRowAppearsWhenHeroIsPresent() {
        let state = TodayState(
            hero: task(id: "a", title: "Lunch", startTime: 12.0, duration: 60),
            currentAccent: "#FF5E96",
            isEmpty: false
        )
        let rows = factory().toRowList(todayState: state, weekState: emptyWeek())
        let hero = rows.compactMap { item -> String? in
            if case .heroRow(let task, _, _, let status, _, _) = item { return "\(task.title)|\(status)" }
            return nil
        }.first
        XCTAssertEqual(hero?.split(separator: "|").first.map(String.init), "Lunch")
        XCTAssertFalse(hero?.split(separator: "|").last?.isEmpty ?? true)
    }

    func testInboxItemsAppearWithOverflowMoreRow() {
        let inbox = (1...10).map { task(id: "i\($0)", title: "Task \($0)") }
        var state = emptyToday()
        state.inbox = inbox
        state.isEmpty = false
        let rows = factory().toRowList(todayState: state, weekState: emptyWeek())
        let inboxRows = rows.filter {
            if case .inboxRow = $0 { return true }
            return false
        }
        XCTAssertEqual(inboxRows.count, 8)
        XCTAssertTrue(rows.contains { if case .moreRow(let c) = $0 { return c == 2 } else { return false } })
    }

    func testSectionLabelsAppearForInboxAndWeek() {
        var state = emptyToday()
        state.inbox = [task(id: "i1", title: "Inbox 1")]
        state.isEmpty = false
        let rows = factory().toRowList(todayState: state, weekState: emptyWeek())
        let labels = rows.compactMap { item -> String? in
            if case .sectionLabel(let label) = item { return label }
            return nil
        }
        XCTAssertTrue(labels.contains { $0.hasPrefix("INBOX") })
        XCTAssertTrue(labels.contains("THIS WEEK"))
    }

    func testTodayIsSkippedInWeekSection() {
        let rows = factory().toRowList(todayState: emptyToday(), weekState: emptyWeek())
        let weekLabel = rows.firstIndex { if case .sectionLabel("THIS WEEK") = $0 { return true } else { return false } } ?? 0
        let afterWeek = rows.dropFirst(weekLabel).compactMap { item -> DayDate? in
            if case .dayHeader(let date, _, _, _) = item { return date }
            return nil
        }
        XCTAssertFalse(afterWeek.contains(today))
    }

    func testAllDayTasksAppearInTodaySection() {
        var state = emptyToday()
        state.allDay = [task(id: "a", title: "All day", isAllDay: true)]
        state.isEmpty = false
        let rows = factory().toRowList(todayState: state, weekState: emptyWeek())
        XCTAssertTrue(rows.contains {
            if case .taskRow(let t, _, _) = $0 { return t.title == "All day" }
            return false
        })
    }

    func testEmptyDaysShowFreeRow() {
        let rows = factory().toRowList(todayState: emptyToday(), weekState: emptyWeek())
        let freeCount = rows.filter { if case .emptyDay = $0 { return true } else { return false } }.count
        XCTAssertGreaterThan(freeCount, 0)
    }

    func testCompactModeOmitsWeekSection() {
        var state = emptyToday()
        state.inbox = [task(id: "i1", title: "Inbox 1")]
        state.isEmpty = false
        let rows = factory(compact: true).toRowList(todayState: state, weekState: emptyWeek())
        XCTAssertFalse(rows.contains { if case .sectionLabel("THIS WEEK") = $0 { return true } else { return false } })
    }

    func testDueSectionAppearsFirstWhenDueTasksExist() {
        var state = emptyToday()
        state.due = [task(id: "d1", title: "Overdue", day: "2026-07-05")]
        state.isEmpty = false
        let rows = factory().toRowList(todayState: state, weekState: emptyWeek())
        if case .sectionLabel(let label) = rows.first {
            XCTAssertEqual(label, "DUE · 1")
        } else {
            XCTFail("expected due section first")
        }
    }

    func testDueTasksPreserveNewestFirstOrderFromState() {
        var state = emptyToday()
        state.due = [
            task(id: "d2", title: "Yesterday", day: "2026-07-05"),
            task(id: "d1", title: "Older", day: "2026-07-03"),
        ]
        state.isEmpty = false
        let rows = factory().toRowList(todayState: state, weekState: emptyWeek())
        let dueRows = rows.compactMap { item -> String? in
            if case .dueRow(let task, _, _) = item { return task.title }
            return nil
        }
        XCTAssertEqual(dueRows, ["Yesterday", "Older"])
    }

    func testDueRowsUseYestLabelForYesterday() {
        var state = emptyToday()
        state.logicalDate = today
        state.due = [task(id: "d1", title: "Missed", day: "2026-07-05")]
        state.isEmpty = false
        let rows = factory().toRowList(todayState: state, weekState: emptyWeek())
        let label = rows.compactMap { item -> String? in
            if case .dueRow(_, let dayLabel, _) = item { return dayLabel }
            return nil
        }.first
        XCTAssertEqual(label, "YEST")
    }

    func testDueSectionCapsAtEightWithMoreRow() {
        var state = emptyToday()
        state.due = (1...10).map { task(id: "d\($0)", title: "Due \($0)", day: "2026-07-05") }
        state.isEmpty = false
        let rows = factory().toRowList(todayState: state, weekState: emptyWeek())
        let dueCount = rows.filter { if case .dueRow = $0 { return true } else { return false } }.count
        XCTAssertEqual(dueCount, 8)
        XCTAssertTrue(rows.contains { if case .moreRow(let c) = $0 { return c == 2 } else { return false } })
    }

    func testDueSectionCapsAtFourInCompactMode() {
        var state = emptyToday()
        state.due = (1...6).map { task(id: "d\($0)", title: "Due \($0)", day: "2026-07-05") }
        state.isEmpty = false
        let rows = factory(compact: true).toRowList(todayState: state, weekState: emptyWeek())
        let dueCount = rows.filter { if case .dueRow = $0 { return true } else { return false } }.count
        XCTAssertEqual(dueCount, 4)
        XCTAssertTrue(rows.contains { if case .moreRow(let c) = $0 { return c == 2 } else { return false } })
        XCTAssertFalse(rows.contains { if case .sectionLabel("THIS WEEK") = $0 { return true } else { return false } })
    }

    func testDueOnlyStateHasNoEmptyBanner() {
        let state = TodayState(
            due: [task(id: "d1", title: "Overdue", day: "2026-07-05")],
            isEmpty: false
        )
        let rows = factory().toRowList(todayState: state, weekState: emptyWeek())
        XCTAssertTrue(banners(rows).isEmpty)
    }

    func testDueRowsAreDistinctFromTaskRows() {
        var state = emptyToday()
        state.due = [task(id: "d1", title: "Overdue", day: "2026-07-05")]
        state.hero = task(id: "h1", title: "Today task", startTime: 14.0, duration: 60)
        state.isEmpty = false
        let rows = factory().toRowList(todayState: state, weekState: emptyWeek())
        XCTAssertTrue(rows.contains { if case .dueRow = $0 { return true } else { return false } })
        XCTAssertTrue(rows.contains {
            if case .taskRow = $0 { return true }
            if case .heroRow = $0 { return true }
            return false
        })
        XCTAssertFalse(rows.contains {
            if case .taskRow(let t, _, _) = $0 { return t.id == "d1" }
            return false
        })
    }
}
