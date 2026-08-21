import Foundation

public struct Alert: Equatable, Codable, Sendable {
    public var type: String
    public var offset: Int?

    public init(type: String, offset: Int?) {
        self.type = type
        self.offset = offset
    }
}

public struct StructuredTask: Equatable, Codable, Sendable, Identifiable {
    public var id: String
    public var title: String
    public var day: String?
    public var startTime: Double?
    public var duration: Int
    public var isAllDay: Bool
    public var isInInbox: Bool
    public var color: String
    public var note: String
    public var completedAt: String?
    public var timezone: String?
    public var alerts: [Alert]
    public var symbol: String?

    public init(
        id: String,
        title: String,
        day: String? = nil,
        startTime: Double? = nil,
        duration: Int = 0,
        isAllDay: Bool = false,
        isInInbox: Bool = false,
        color: String = "#5E96CB",
        note: String = "",
        completedAt: String? = nil,
        timezone: String? = nil,
        alerts: [Alert] = [],
        symbol: String? = nil
    ) {
        self.id = id
        self.title = title
        self.day = day
        self.startTime = startTime
        self.duration = duration
        self.isAllDay = isAllDay
        self.isInInbox = isInInbox
        self.color = color
        self.note = note
        self.completedAt = completedAt
        self.timezone = timezone
        self.alerts = alerts
        self.symbol = symbol
    }

    public var isCompleted: Bool {
        guard let completedAt, !completedAt.isEmpty, completedAt != "null" else { return false }
        return true
    }
}

public struct WidgetSnapshot: Equatable, Codable, Sendable {
    public var logicalDate: DayDate
    public var timezone: String
    public var dayStartsAt: ClockTime
    public var generatedAt: String
    public var version: String
    public var today: [StructuredTask]
    public var inbox: [StructuredTask]
    public var due: [StructuredTask]
    public var tomorrow: [StructuredTask]
    public var week: [StructuredTask]

    public init(
        logicalDate: DayDate,
        timezone: String,
        dayStartsAt: ClockTime,
        generatedAt: String,
        version: String,
        today: [StructuredTask],
        inbox: [StructuredTask],
        due: [StructuredTask],
        tomorrow: [StructuredTask],
        week: [StructuredTask]
    ) {
        self.logicalDate = logicalDate
        self.timezone = timezone
        self.dayStartsAt = dayStartsAt
        self.generatedAt = generatedAt
        self.version = version
        self.today = today
        self.inbox = inbox
        self.due = due
        self.tomorrow = tomorrow
        self.week = week
    }
}

public enum WidgetDisplayState: String, Equatable, Codable, Sendable {
    case live
    case demo
    case stale
    case offline
    case relink
}

public struct TodayState: Equatable, Codable, Sendable {
    public var allDay: [StructuredTask]
    public var hero: StructuredTask?
    public var upNext: [StructuredTask]
    public var inbox: [StructuredTask]
    public var tomorrow: [StructuredTask]
    public var due: [StructuredTask]
    public var currentAccent: String?
    public var isEmpty: Bool
    public var logicalDate: DayDate?
    public var serverTimezone: String?
    public var timezoneMismatch: Bool

    public init(
        allDay: [StructuredTask] = [],
        hero: StructuredTask? = nil,
        upNext: [StructuredTask] = [],
        inbox: [StructuredTask] = [],
        tomorrow: [StructuredTask] = [],
        due: [StructuredTask] = [],
        currentAccent: String? = nil,
        isEmpty: Bool = true,
        logicalDate: DayDate? = nil,
        serverTimezone: String? = nil,
        timezoneMismatch: Bool = false
    ) {
        self.allDay = allDay
        self.hero = hero
        self.upNext = upNext
        self.inbox = inbox
        self.tomorrow = tomorrow
        self.due = due
        self.currentAccent = currentAccent
        self.isEmpty = isEmpty
        self.logicalDate = logicalDate
        self.serverTimezone = serverTimezone
        self.timezoneMismatch = timezoneMismatch
    }
}

public struct DayBlock: Equatable, Codable, Sendable {
    public var date: DayDate
    public var timed: [StructuredTask]
    public var allDay: [StructuredTask]
    public var totalTasks: Int
    public var isToday: Bool
    public var isYesterday: Bool

    public init(
        date: DayDate,
        timed: [StructuredTask],
        allDay: [StructuredTask],
        totalTasks: Int,
        isToday: Bool,
        isYesterday: Bool
    ) {
        self.date = date
        self.timed = timed
        self.allDay = allDay
        self.totalTasks = totalTasks
        self.isToday = isToday
        self.isYesterday = isYesterday
    }
}

public struct WeekState: Equatable, Codable, Sendable {
    public var days: [DayBlock]

    public init(days: [DayBlock]) {
        self.days = days
    }
}

public enum TaskListItem: Equatable, Sendable {
    public enum BannerKind: String, Equatable, Sendable {
        case info
        case empty
        case error
        case warning
    }

    case dayHeader(date: DayDate, label: String, isToday: Bool, isYesterday: Bool)
    case taskRow(task: StructuredTask, isPast: Bool, isCurrent: Bool)
    case inboxRow(StructuredTask)
    case dueRow(task: StructuredTask, dayLabel: String, timeLabel: String?)
    case moreRow(count: Int)
    case emptyDay(DayDate)
    case heroRow(
        task: StructuredTask,
        accent: String,
        countdown: String,
        statusLabel: String,
        progress: Float,
        timeRange: String
    )
    case sectionLabel(String)
    case statusBanner(message: String, kind: BannerKind)
}

public struct WidgetCacheEntry: Equatable, Codable, Sendable {
    public var todayState: TodayState
    public var weekState: WeekState
    public var version: String
    public var etag: String?
    public var displayState: WidgetDisplayState
    public var logicalDate: DayDate?
    public var fetchedAtMs: Int64

    public init(
        todayState: TodayState,
        weekState: WeekState,
        version: String,
        etag: String?,
        displayState: WidgetDisplayState,
        logicalDate: DayDate?,
        fetchedAtMs: Int64
    ) {
        self.todayState = todayState
        self.weekState = weekState
        self.version = version
        self.etag = etag
        self.displayState = displayState
        self.logicalDate = logicalDate
        self.fetchedAtMs = fetchedAtMs
    }
}

public struct Credentials: Equatable, Sendable {
    public var baseURL: String
    public var discordId: String
    public var widgetToken: String

    public init(baseURL: String, discordId: String, widgetToken: String) {
        var url = baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
        while url.hasSuffix("/") { url.removeLast() }
        self.baseURL = url
        self.discordId = discordId.trimmingCharacters(in: .whitespacesAndNewlines)
        self.widgetToken = widgetToken.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    public var isConfigured: Bool {
        !baseURL.isEmpty && !discordId.isEmpty && !widgetToken.isEmpty
    }

    public var maskedToken: String {
        if widgetToken.count <= 8 { return "••••" }
        return "\(widgetToken.prefix(6))…\(widgetToken.suffix(4))"
    }
}

public enum WidgetStrings {
    public static let appName = "Structured Widget"
    public static let widgetName = "Planner · Day & Week"
    public static let settingsSubtitle = "Connect your planner backend for live home-screen widgets"
    public static let defaultBaseURL = "http://127.0.0.1:8003"
    public static let helperBackendURL = "e.g. http://HOST:8003"
    public static let helperWidgetToken = "From Discord /link (wt_…)"
    public static let setupSteps = """
        1. Discord /link → copy ID + token
        2. Save credentials
        3. Test connection
        4. Add widget: Planner · Day & Week
        """
    public static let weekFree = "Free"
    public static func weekMore(_ count: Int) -> String { "+\(count) more" }
}

public struct BannerCopy: Equatable, Sendable {
    public var demo: String
    public var stale: String
    public var offline: String
    public var relink: String
    public var timezoneMismatch: String
    public var emptyDay: String

    public init(
        demo: String = "Sample schedule — connect in app for live data",
        stale: String = "Data may be outdated — last refresh was a while ago",
        offline: String = "Offline — showing last known schedule",
        relink: String = "Session expired — re-link in Discord (/link)",
        timezoneMismatch: String = "Timezone differs from server — times may be off",
        emptyDay: String = "Nothing scheduled — enjoy the open day"
    ) {
        self.demo = demo
        self.stale = stale
        self.offline = offline
        self.relink = relink
        self.timezoneMismatch = timezoneMismatch
        self.emptyDay = emptyDay
    }

    public static let `default` = BannerCopy()
}
