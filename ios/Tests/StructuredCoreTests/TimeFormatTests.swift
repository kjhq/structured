import XCTest
import StructuredCore

final class TimeFormatTests: XCTestCase {
    func testFormatHour12hOnTheHour() {
        XCTAssertEqual(TimeFormat.formatHour(9.0, use24h: false), "9a")
        XCTAssertEqual(TimeFormat.formatHour(0.0, use24h: false), "12a")
        XCTAssertEqual(TimeFormat.formatHour(12.0, use24h: false), "12p")
        XCTAssertEqual(TimeFormat.formatHour(13.0, use24h: false), "1p")
    }

    func testFormatHour12hWithMinutes() {
        XCTAssertEqual(TimeFormat.formatHour(9.5, use24h: false), "9:30a")
        XCTAssertEqual(TimeFormat.formatHour(14.25, use24h: false), "2:15p")
    }

    func testFormatHour24h() {
        XCTAssertEqual(TimeFormat.formatHour(9.0, use24h: true), "09:00")
        XCTAssertEqual(TimeFormat.formatHour(14.5, use24h: true), "14:30")
    }

    func testFormatDuration() {
        XCTAssertEqual(TimeFormat.formatDuration(45), "45m")
        XCTAssertEqual(TimeFormat.formatDuration(60), "1h")
        XCTAssertEqual(TimeFormat.formatDuration(90), "1h 30m")
        XCTAssertEqual(TimeFormat.formatDuration(0), "0m")
    }

    func testHourOfDayFraction() {
        XCTAssertEqual(TimeFormat.hourOfDayFraction(hour: 0, minute: 0), 0, accuracy: 0.0001)
        XCTAssertEqual(TimeFormat.hourOfDayFraction(hour: 12, minute: 0), 0.5, accuracy: 0.0001)
        XCTAssertEqual(TimeFormat.hourOfDayFraction(hour: 23, minute: 59), 0.999, accuracy: 0.002)
    }

    func testRelativeUpdated() {
        XCTAssertEqual(TimeFormat.formatRelativeUpdated(ageMs: 0), "just now")
        XCTAssertEqual(TimeFormat.formatRelativeUpdated(ageMs: 60_000), "1 min ago")
        XCTAssertEqual(TimeFormat.formatRelativeUpdated(ageMs: 5 * 60_000), "5 min ago")
        XCTAssertEqual(TimeFormat.formatRelativeUpdated(ageMs: 60 * 60_000), "1h ago")
        XCTAssertEqual(TimeFormat.formatRelativeUpdated(ageMs: 3 * 60 * 60_000), "3h ago")
    }
}

final class DayDateTests: XCTestCase {
    func testISORoundTrip() {
        let d = DayDate(isoString: "2026-07-06")
        XCTAssertEqual(d, DayDate(year: 2026, month: 7, day: 6))
        XCTAssertEqual(d?.isoString, "2026-07-06")
    }

    func testAddingDaysAcrossMonth() {
        let d = DayDate(year: 2026, month: 7, day: 31)
        XCTAssertEqual(d.adding(days: 1).isoString, "2026-08-01")
        XCTAssertEqual(d.adding(days: -1).isoString, "2026-07-30")
    }

    func testFormattedHeaders() {
        let d = DayDate(year: 2026, month: 7, day: 6)
        XCTAssertEqual(d.formattedWeekdayMonthDay(), "MON JUL 6")
        XCTAssertEqual(d.formattedWeekday(), "MON")
        XCTAssertEqual(d.formattedMonthDay(), "JUL 6")
    }
}
