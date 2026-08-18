import Foundation

/// Calendar day in the server's logical timezone, stored as ISO `YYYY-MM-DD`.
public struct DayDate: Hashable, Codable, Sendable, Comparable, CustomStringConvertible {
    public var year: Int
    public var month: Int
    public var day: Int

    public init(year: Int, month: Int, day: Int) {
        self.year = year
        self.month = month
        self.day = day
    }

    public init?(isoString: String) {
        let parts = isoString.split(separator: "-")
        guard parts.count == 3,
              let y = Int(parts[0]),
              let m = Int(parts[1]),
              let d = Int(parts[2])
        else { return nil }
        self.init(year: y, month: m, day: d)
    }

    public var isoString: String {
        String(format: "%04d-%02d-%02d", year, month, day)
    }

    public var description: String { isoString }

    public static func < (lhs: DayDate, rhs: DayDate) -> Bool {
        if lhs.year != rhs.year { return lhs.year < rhs.year }
        if lhs.month != rhs.month { return lhs.month < rhs.month }
        return lhs.day < rhs.day
    }

    public func adding(days: Int) -> DayDate {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let comps = DateComponents(year: year, month: month, day: day)
        guard let date = calendar.date(from: comps),
              let next = calendar.date(byAdding: .day, value: days, to: date)
        else { return self }
        let c = calendar.dateComponents([.year, .month, .day], from: next)
        return DayDate(year: c.year ?? year, month: c.month ?? month, day: c.day ?? day)
    }

    /// `EEE MMM d` in US locale, uppercased — matches Android widget headers.
    public func formattedWeekdayMonthDay() -> String {
        formatted("EEE MMM d").uppercased()
    }

    /// `EEE` in US locale, uppercased.
    public func formattedWeekday() -> String {
        formatted("EEE").uppercased()
    }

    /// `MMM d` in US locale, uppercased.
    public func formattedMonthDay() -> String {
        formatted("MMM d").uppercased()
    }

    private func formatted(_ format: String) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let comps = DateComponents(year: year, month: month, day: day)
        guard let date = calendar.date(from: comps) else { return isoString }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = format
        return formatter.string(from: date)
    }

    public static func today(in timeZone: TimeZone = .current, now: Date = Date()) -> DayDate {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let c = calendar.dateComponents([.year, .month, .day], from: now)
        return DayDate(year: c.year ?? 1970, month: c.month ?? 1, day: c.day ?? 1)
    }
}

public struct ClockTime: Equatable, Codable, Sendable {
    public var hour: Int
    public var minute: Int

    public init(hour: Int, minute: Int) {
        self.hour = hour
        self.minute = minute
    }

    public var hours: Double {
        Double(hour) + Double(minute) / 60.0
    }

    public var totalMinutes: Int {
        hour * 60 + minute
    }

    public static func now(in timeZone: TimeZone = .current, date: Date = Date()) -> ClockTime {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let c = calendar.dateComponents([.hour, .minute], from: date)
        return ClockTime(hour: c.hour ?? 0, minute: c.minute ?? 0)
    }
}
