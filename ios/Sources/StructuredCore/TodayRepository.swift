import Foundation

public struct TodayRepository: Sendable {
    public var now: @Sendable () -> ClockTime
    public var deviceTimeZoneId: @Sendable () -> String

    public init(
        now: @escaping @Sendable () -> ClockTime = { ClockTime.now() },
        deviceTimeZoneId: @escaping @Sendable () -> String = { TimeZone.current.identifier }
    ) {
        self.now = now
        self.deviceTimeZoneId = deviceTimeZoneId
    }

    public func fromSnapshot(_ snapshot: WidgetSnapshot) -> TodayState {
        let today = snapshot.logicalDate
        let nowHours = now().hours

        let inbox = snapshot.inbox.filter { !$0.isCompleted }
        let due = snapshot.due
            .filter { !$0.isCompleted }
            .sorted { lhs, rhs in
                let ld = lhs.day ?? ""
                let rd = rhs.day ?? ""
                if ld != rd { return ld > rd }
                let ls = lhs.startTime ?? Double.greatestFiniteMagnitude
                let rs = rhs.startTime ?? Double.greatestFiniteMagnitude
                return ls < rs
            }
        let tomorrow = snapshot.tomorrow.filter { !$0.isCompleted }

        let all = snapshot.today.filter { !$0.isCompleted }
        let sorted = all.sorted { lhs, rhs in
            if lhs.isAllDay != rhs.isAllDay { return lhs.isAllDay && !rhs.isAllDay }
            let ls = lhs.startTime ?? Double.greatestFiniteMagnitude
            let rs = rhs.startTime ?? Double.greatestFiniteMagnitude
            return ls < rs
        }
        let allDay = sorted.filter(\.isAllDay)
        let timed = sorted.filter { !$0.isAllDay }

        let inProgress = timed.first { t in
            guard let start = t.startTime else { return false }
            let end = start + Double(t.duration) / 60.0
            return nowHours >= start && nowHours <= end
        }
        let upcoming = timed.filter { t in
            guard let start = t.startTime else { return false }
            return start > nowHours
        }
        let hero = inProgress ?? upcoming.first ?? timed.last

        let upNext = timed
            .filter { $0.id != hero?.id }
            .filter { t in
                guard let start = t.startTime else { return true }
                return start >= nowHours - 0.5
            }
            .prefix(6)

        return TodayState(
            allDay: allDay,
            hero: hero,
            upNext: Array(upNext),
            inbox: inbox,
            tomorrow: tomorrow,
            due: due,
            currentAccent: hero?.color,
            isEmpty: all.isEmpty && inbox.isEmpty && due.isEmpty,
            logicalDate: today,
            serverTimezone: snapshot.timezone,
            timezoneMismatch: Self.isTimezoneMismatch(snapshot.timezone, device: deviceTimeZoneId())
        )
    }

    public static func isTimezoneMismatch(_ serverTimezone: String, device: String) -> Bool {
        if serverTimezone.isEmpty { return false }
        return serverTimezone.caseInsensitiveCompare(device) != .orderedSame
    }
}

public struct WeekRepository: Sendable {
    public init() {}

    public func fromSnapshot(_ snapshot: WidgetSnapshot) -> WeekState {
        let today = snapshot.logicalDate
        let tasks = snapshot.week
        let days: [DayBlock] = (0...7).map { offset in
            let date = today.adding(days: offset)
            let dayTasks = tasks.filter { $0.day == date.isoString }
            let sorted = dayTasks.sorted { ($0.startTime ?? .greatestFiniteMagnitude) < ($1.startTime ?? .greatestFiniteMagnitude) }
            let timed = sorted.filter { !$0.isAllDay }
            let allDay = sorted.filter(\.isAllDay)
            return DayBlock(
                date: date,
                timed: timed,
                allDay: allDay,
                totalTasks: timed.count + allDay.count,
                isToday: date == today,
                isYesterday: date == today.adding(days: -1)
            )
        }
        return WeekState(days: days)
    }
}

public enum WidgetHeader {
    public static func todayTaskCount(_ todayState: TodayState?) -> Int {
        guard let todayState else { return 0 }
        let heroExtra = todayState.hero == nil ? 0 : 1
        return todayState.allDay.count + todayState.upNext.count + heroExtra
    }
}
