import Foundation

public enum SampleData {
    public static func forDate(_ date: DayDate, today: DayDate) -> [StructuredTask] {
        let day = date.isoString
        if date == today {
            return [
                task("s1", "Morning workout", day, 7.0, 60, color: "#FF6B6B", symbol: "dumbbell"),
                task("s2", "Deep work block", day, 9.5, 90, color: "#5E96CB", symbol: "pencil"),
                task("s3", "Team standup", day, 11.0, 30, color: "#4ECDC4", symbol: "text.badge.checkmark"),
                task("s4", "Lunch", day, 12.5, 45, color: "#F7B731", symbol: "sun.max.fill"),
                task("s5", "Design review", day, 14.0, 60, color: "#A55EEA", symbol: "pencil.and.outline"),
                task("s6", "Commute home", day, 18.0, 40, color: "#26C6DA", symbol: "car"),
                task("s7", "Wind down", day, 21.5, 30, color: "#778BEB", symbol: "moon.fill"),
                task("s8", "All-day focus flag", day, nil, 0, isAllDay: true, color: "#45AAF2", symbol: "flag"),
            ]
        }
        if date == today.adding(days: 1) {
            return [
                task("t1", "Doctor appointment", day, 10.0, 45, color: "#FC5C65", symbol: "alarm.fill"),
                task("t2", "Write weekly review", day, 15.0, 60, color: "#5E96CB", symbol: "pencil"),
            ]
        }
        if date == today.adding(days: 2) {
            return [
                task("u1", "Bike ride", day, 7.5, 75, color: "#26DE81", symbol: "bicycle"),
                task("u2", "Groceries", day, 17.0, 40, color: "#FD9644", symbol: "house"),
            ]
        }
        if date == today.adding(days: 3) {
            return [
                task("v1", "Project deadline", day, nil, 0, isAllDay: true, color: "#EB3B5A", symbol: "calendar"),
                task("v2", "Dinner with friends", day, 19.0, 90, color: "#F7B731", symbol: "sun.fill"),
            ]
        }
        return []
    }

    public static func inbox() -> [StructuredTask] {
        [
            task("i1", "Reply to Alex", nil, nil, 0, isInInbox: true, color: "#5E96CB", symbol: "text.bubble"),
            task("i2", "Book flights", nil, nil, 0, isInInbox: true, color: "#A55EEA", symbol: "airplane"),
            task("i3", "Order new charger", nil, nil, 0, isInInbox: true, color: "#26C6DA", symbol: "bag"),
        ]
    }

    public static func overdue(today: DayDate) -> [StructuredTask] {
        let yesterday = today.adding(days: -1).isoString
        let twoDaysAgo = today.adding(days: -2).isoString
        return [
            task("d1", "Finish report", yesterday, 14.0, 60, color: "#EB3B5A", symbol: "pencil"),
            task("d2", "Call dentist", yesterday, nil, 0, isAllDay: true, color: "#FC5C65", symbol: "alarm.fill"),
            task("d3", "Review PR", twoDaysAgo, 10.0, 30, color: "#5E96CB", symbol: "text.badge.checkmark"),
        ]
    }

    public static func demoSnapshot(
        today: DayDate,
        timezone: String
    ) -> WidgetSnapshot {
        let tomorrow = today.adding(days: 1)
        let weekTasks = (0...7).flatMap { offset -> [StructuredTask] in
            let d = today.adding(days: offset)
            return forDate(d, today: today).map { t in
                if t.day == nil && !t.isInInbox {
                    var copy = t
                    copy.day = d.isoString
                    return copy
                }
                return t
            }
        }
        return WidgetSnapshot(
            logicalDate: today,
            timezone: timezone,
            dayStartsAt: ClockTime(hour: 4, minute: 0),
            generatedAt: "",
            version: "demo",
            today: forDate(today, today: today).map { t in
                if t.day == nil && !t.isInInbox {
                    var copy = t
                    copy.day = today.isoString
                    return copy
                }
                return t
            },
            inbox: inbox(),
            due: overdue(today: today),
            tomorrow: forDate(tomorrow, today: today).map { t in
                if t.day == nil && !t.isInInbox {
                    var copy = t
                    copy.day = tomorrow.isoString
                    return copy
                }
                return t
            },
            week: weekTasks
        )
    }

    private static func task(
        _ id: String,
        _ title: String,
        _ day: String?,
        _ startTime: Double?,
        _ duration: Int,
        isAllDay: Bool = false,
        isInInbox: Bool = false,
        color: String,
        symbol: String?
    ) -> StructuredTask {
        StructuredTask(
            id: id,
            title: title,
            day: day,
            startTime: startTime,
            duration: duration,
            isAllDay: isAllDay,
            isInInbox: isInInbox,
            color: color,
            note: "",
            completedAt: nil,
            timezone: nil,
            alerts: [],
            symbol: symbol
        )
    }
}
