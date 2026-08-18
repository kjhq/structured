import Foundation

public final class WidgetCache: @unchecked Sendable {
    private let lock = NSLock()
    private var entry: WidgetCacheEntry?
    private var lastWasManual = false

    public init() {}

    public func get() -> WidgetCacheEntry? {
        lock.lock(); defer { lock.unlock() }
        return entry
    }

    public func etag() -> String? { get()?.etag }
    public func version() -> String? { get()?.version }
    public func displayState() -> WidgetDisplayState { get()?.displayState ?? .demo }
    public func wasManual() -> Bool {
        lock.lock(); defer { lock.unlock() }
        return lastWasManual
    }

    public func age(nowMs: Int64) -> Int64 {
        guard let fetched = get()?.fetchedAtMs else { return Int64.max }
        return nowMs - fetched
    }

    /// Versioned write — only replaces cache when `version` differs from current.
    @discardableResult
    public func trySet(
        todayState: TodayState,
        weekState: WeekState,
        version: String,
        etag: String?,
        displayState: WidgetDisplayState,
        logicalDate: DayDate?,
        manual: Bool = false,
        nowMs: Int64
    ) -> Bool {
        lock.lock(); defer { lock.unlock() }
        if let current = entry, version == current.version {
            return false
        }
        entry = WidgetCacheEntry(
            todayState: todayState,
            weekState: weekState,
            version: version,
            etag: etag,
            displayState: displayState,
            logicalDate: logicalDate,
            fetchedAtMs: nowMs
        )
        lastWasManual = manual
        return true
    }

    public func forceSet(
        todayState: TodayState,
        weekState: WeekState,
        version: String,
        etag: String?,
        displayState: WidgetDisplayState,
        logicalDate: DayDate?,
        manual: Bool = false,
        nowMs: Int64
    ) {
        lock.lock(); defer { lock.unlock() }
        entry = WidgetCacheEntry(
            todayState: todayState,
            weekState: weekState,
            version: version,
            etag: etag,
            displayState: displayState,
            logicalDate: logicalDate,
            fetchedAtMs: nowMs
        )
        lastWasManual = manual
    }

    public func restore(_ entry: WidgetCacheEntry?) {
        lock.lock(); defer { lock.unlock() }
        self.entry = entry
    }

    public func clear() {
        lock.lock(); defer { lock.unlock() }
        entry = nil
        lastWasManual = false
    }

    public static func isNewerVersion(_ incoming: String, current: String) -> Bool {
        incoming != current
    }
}
