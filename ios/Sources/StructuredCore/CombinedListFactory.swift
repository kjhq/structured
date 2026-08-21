import Foundation

public struct CombinedListFactory: Sendable {
    public var use24h: Bool
    public var compact: Bool
    public var clock: @Sendable () -> DayDate
    public var now: @Sendable () -> ClockTime
    public var banners: BannerCopy

    public static let maxDue = 8
    public static let maxDueCompact = 4
    public static let maxTomorrow = 4
    public static let maxTimedPerWeekDay = 5
    public static let maxInbox = 8

    public init(
        use24h: Bool = false,
        compact: Bool = false,
        clock: @escaping @Sendable () -> DayDate = { DayDate.today() },
        now: @escaping @Sendable () -> ClockTime = { ClockTime.now() },
        banners: BannerCopy = .default
    ) {
        self.use24h = use24h
        self.compact = compact
        self.clock = clock
        self.now = now
        self.banners = banners
    }

    public func toRowList(
        todayState: TodayState,
        weekState: WeekState,
        displayState: WidgetDisplayState = .live,
        timezoneMismatch: Bool? = nil
    ) -> [TaskListItem] {
        var rows: [TaskListItem] = []
        if let banner = statusBanner(for: displayState) {
            rows.append(banner)
        }
        let mismatch = timezoneMismatch ?? todayState.timezoneMismatch
        if mismatch && displayState != .demo {
            rows.append(.statusBanner(message: banners.timezoneMismatch, kind: .warning))
        }
        let accent = todayState.currentAccent ?? WidgetTheme.defaultAccentHex
        let today = todayState.logicalDate ?? clock()
        let nowHours = now().hours
        let nowMin = now().totalMinutes

        if !todayState.due.isEmpty {
            let maxDue = compact ? Self.maxDueCompact : Self.maxDue
            rows.append(.sectionLabel("DUE · \(todayState.due.count)"))
            for task in todayState.due.prefix(maxDue) {
                rows.append(.dueRow(
                    task: task,
                    dayLabel: dueDayLabel(task, today: today),
                    timeLabel: dueTimeLabel(task)
                ))
            }
            let overflow = todayState.due.count - maxDue
            if overflow > 0 {
                rows.append(.moreRow(count: overflow))
            }
        }

        if todayState.isEmpty {
            rows.append(.statusBanner(message: banners.emptyDay, kind: .empty))
        }

        if let hero = todayState.hero {
            let start = hero.startTime
            let startMin = Int((start ?? 0.0) * 60)
            let endMin = startMin + hero.duration

            let status: String
            let countdown: String
            let progress: Float
            if start == nil {
                status = "ALL DAY"
                countdown = ""
                progress = 0
            } else if nowMin >= startMin && nowMin <= endMin {
                let left = endMin - nowMin
                let span = max(1, hero.duration)
                let done = min(1, max(0, Float(nowMin - startMin) / Float(span)))
                status = "NOW"
                countdown = "\(TimeFormat.formatDuration(left)) left"
                progress = done
            } else if nowMin < startMin {
                let wait = startMin - nowMin
                status = "NEXT"
                countdown = "in \(TimeFormat.formatDuration(wait))"
                progress = 0
            } else {
                status = "DONE"
                countdown = "passed"
                progress = 1
            }

            var range = ""
            if let start {
                range += TimeFormat.formatHour(start, use24h: use24h)
                if hero.duration > 0 {
                    range += " – "
                    range += TimeFormat.formatHour(start + Double(hero.duration) / 60.0, use24h: use24h)
                    range += " · "
                    range += TimeFormat.formatDuration(hero.duration)
                }
            }

            rows.append(.heroRow(
                task: hero,
                accent: accent,
                countdown: countdown,
                statusLabel: status,
                progress: progress,
                timeRange: range
            ))
        }

        for task in todayState.allDay where task.id != todayState.hero?.id {
            rows.append(.taskRow(task: task, isPast: false, isCurrent: false))
        }

        for t in todayState.upNext {
            let start = t.startTime
            let end = start.map { $0 + Double(t.duration) / 60.0 }
            let isCurrent = start != nil && end != nil && nowHours >= start! && nowHours <= end!
            let isPast = end.map { nowHours > $0 } ?? false
            rows.append(.taskRow(task: t, isPast: isPast, isCurrent: isCurrent))
        }

        if !todayState.inbox.isEmpty {
            rows.append(.sectionLabel("INBOX · \(todayState.inbox.count)"))
            for task in todayState.inbox.prefix(Self.maxInbox) {
                rows.append(.inboxRow(task))
            }
            let overflow = todayState.inbox.count - Self.maxInbox
            if overflow > 0 {
                rows.append(.moreRow(count: overflow))
            }
        }

        if !compact && !todayState.tomorrow.isEmpty {
            let tomorrow = today.adding(days: 1)
            rows.append(.sectionLabel(
                "TOMORROW · \(tomorrow.formattedWeekday()) · \(todayState.tomorrow.count)"
            ))
            for task in todayState.tomorrow.prefix(Self.maxTomorrow) {
                rows.append(.taskRow(task: task, isPast: false, isCurrent: false))
            }
            let overflow = todayState.tomorrow.count - Self.maxTomorrow
            if overflow > 0 {
                rows.append(.moreRow(count: overflow))
            }
        }

        if !compact {
            rows.append(.sectionLabel("THIS WEEK"))
            for day in weekState.days {
                if day.isToday { continue }
                if day.date == today.adding(days: 1) && !todayState.tomorrow.isEmpty { continue }
                rows.append(headerFor(day, today: today))
                if day.timed.isEmpty && day.allDay.isEmpty {
                    rows.append(.emptyDay(day.date))
                    continue
                }
                for task in day.allDay {
                    rows.append(.taskRow(task: task, isPast: false, isCurrent: false))
                }
                for task in day.timed.prefix(Self.maxTimedPerWeekDay) {
                    rows.append(.taskRow(task: task, isPast: false, isCurrent: false))
                }
                if day.timed.count > Self.maxTimedPerWeekDay {
                    rows.append(.moreRow(count: day.timed.count - Self.maxTimedPerWeekDay))
                }
            }
        }

        return rows
    }

    private func headerFor(_ day: DayBlock, today: DayDate) -> TaskListItem {
        let dateText = day.date.formattedWeekdayMonthDay()
        let label: String
        if day.isToday {
            label = "●  TODAY · \(dateText)"
        } else if day.isYesterday {
            label = "\(dateText) · YESTERDAY"
        } else if day.date == today.adding(days: 1) {
            label = "\(dateText) · TOMORROW"
        } else {
            label = dateText
        }
        return .dayHeader(date: day.date, label: label, isToday: day.isToday, isYesterday: day.isYesterday)
    }

    private func dueDayLabel(_ task: StructuredTask, today: DayDate) -> String {
        guard let dayStr = task.day, let taskDay = DayDate(isoString: dayStr) else { return "" }
        if taskDay == today.adding(days: -1) {
            return "YEST"
        }
        return taskDay.formattedMonthDay()
    }

    private func dueTimeLabel(_ task: StructuredTask) -> String? {
        if task.isAllDay || task.startTime == nil { return nil }
        return TimeFormat.formatHour(task.startTime!, use24h: use24h)
    }

    private func statusBanner(for state: WidgetDisplayState) -> TaskListItem? {
        switch state {
        case .demo:
            return .statusBanner(message: banners.demo, kind: .info)
        case .stale:
            return .statusBanner(message: banners.stale, kind: .warning)
        case .offline:
            return .statusBanner(message: banners.offline, kind: .warning)
        case .relink:
            return .statusBanner(message: banners.relink, kind: .error)
        case .live:
            return nil
        }
    }
}
