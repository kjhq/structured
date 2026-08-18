import Foundation

public enum FetchError: Equatable, Sendable {
    case unauthorized
    case http(code: Int, message: String)
    case network(String)
}

public enum SnapshotFetchResult: Equatable, Sendable {
    case ok(snapshot: WidgetSnapshot, etag: String?)
    case notModified(etag: String?)
    case error(FetchError)
}

public struct ProbeResult: Equatable, Sendable {
    public var ok: Bool
    public var message: String
    public var httpCode: Int?

    public init(ok: Bool, message: String, httpCode: Int? = nil) {
        self.ok = ok
        self.message = message
        self.httpCode = httpCode
    }
}

public protocol SnapshotFetching: Sendable {
    func fetchSnapshot(ifNoneMatch: String?) async -> SnapshotFetchResult
}

public protocol MeProbing: Sendable {
    func probeMe() async -> ProbeResult
}

public enum RefreshOutcome: Equatable, Sendable {
    case success(String)
    case authFailure(String)
    case transientFailure(String)

    public var ok: Bool {
        if case .success = self { return true }
        return false
    }

    public var message: String {
        switch self {
        case .success(let m), .authFailure(let m), .transientFailure(let m):
            return m
        }
    }
}

public struct WidgetRefreshCoordinator: Sendable {
    public static let staleThresholdMs: Int64 = 30 * 60 * 1000

    public var cache: WidgetCache
    public var nowMs: @Sendable () -> Int64
    public var todayRepo: TodayRepository
    public var weekRepo: WeekRepository
    public var demoToday: @Sendable () -> DayDate
    public var demoTimeZone: @Sendable () -> String

    public init(
        cache: WidgetCache = WidgetCache(),
        nowMs: @escaping @Sendable () -> Int64 = {
            Int64(Date().timeIntervalSince1970 * 1000)
        },
        todayRepo: TodayRepository = TodayRepository(),
        weekRepo: WeekRepository = WeekRepository(),
        demoToday: @escaping @Sendable () -> DayDate = { DayDate.today() },
        demoTimeZone: @escaping @Sendable () -> String = { TimeZone.current.identifier }
    ) {
        self.cache = cache
        self.nowMs = nowMs
        self.todayRepo = todayRepo
        self.weekRepo = weekRepo
        self.demoToday = demoToday
        self.demoTimeZone = demoTimeZone
    }

    public func refresh(configured: Bool, fetcher: SnapshotFetching, manual: Bool) async -> RefreshOutcome {
        if configured {
            return await refreshFromBackend(fetcher: fetcher, manual: manual)
        }
        return refreshDemo(manual: manual)
    }

    public func refreshFromBackend(fetcher: SnapshotFetching, manual: Bool) async -> RefreshOutcome {
        let etag = manual ? nil : cache.etag()
        let result = await fetcher.fetchSnapshot(ifNoneMatch: etag)
        switch result {
        case .ok(let snapshot, let etag):
            applySnapshot(
                snapshot,
                etag: etag,
                displayState: .live,
                manual: manual,
                force: true
            )
            return .success("Snapshot v=\(snapshot.version) applied")
        case .notModified(let etag):
            if let cached = cache.get() {
                let state = staleDisplayState(current: cached.displayState, fetchedAt: cached.fetchedAtMs)
                cache.forceSet(
                    todayState: cached.todayState,
                    weekState: cached.weekState,
                    version: cached.version,
                    etag: etag ?? cached.etag,
                    displayState: state,
                    logicalDate: cached.logicalDate,
                    manual: manual,
                    nowMs: cached.fetchedAtMs
                )
            }
            return .success("Snapshot not modified (304)")
        case .error(.unauthorized):
            handleAuthFailure(manual: manual)
            return .authFailure("Auth failed — re-link in Discord")
        case .error(let error):
            if handleTransientFailure(manual: manual) {
                return .success("Offline — showing cached data")
            }
            switch error {
            case .http(let code, let message):
                return .transientFailure("HTTP \(code): \(message)")
            case .network(let message):
                return .transientFailure(message)
            case .unauthorized:
                return .authFailure("Auth failed — re-link in Discord")
            }
        }
    }

    public func refreshDemo(manual: Bool) -> RefreshOutcome {
        let snapshot = SampleData.demoSnapshot(today: demoToday(), timezone: demoTimeZone())
        applySnapshot(
            snapshot,
            etag: nil,
            displayState: .demo,
            manual: manual,
            force: true
        )
        return .success("Sample data (no credentials)")
    }

    public func applySnapshot(
        _ snapshot: WidgetSnapshot,
        etag: String?,
        displayState: WidgetDisplayState,
        manual: Bool,
        force: Bool
    ) {
        let todayState = todayRepo.fromSnapshot(snapshot)
        let weekState = weekRepo.fromSnapshot(snapshot)
        if force {
            cache.forceSet(
                todayState: todayState,
                weekState: weekState,
                version: snapshot.version,
                etag: etag,
                displayState: displayState,
                logicalDate: snapshot.logicalDate,
                manual: manual,
                nowMs: nowMs()
            )
        } else {
            cache.trySet(
                todayState: todayState,
                weekState: weekState,
                version: snapshot.version,
                etag: etag,
                displayState: displayState,
                logicalDate: snapshot.logicalDate,
                manual: manual,
                nowMs: nowMs()
            )
        }
    }

    public func handleAuthFailure(manual: Bool) {
        guard let cached = cache.get() else { return }
        cache.forceSet(
            todayState: cached.todayState,
            weekState: cached.weekState,
            version: cached.version,
            etag: cached.etag,
            displayState: .relink,
            logicalDate: cached.logicalDate,
            manual: manual,
            nowMs: cached.fetchedAtMs
        )
    }

    @discardableResult
    public func handleTransientFailure(manual: Bool) -> Bool {
        guard let cached = cache.get() else { return false }
        cache.forceSet(
            todayState: cached.todayState,
            weekState: cached.weekState,
            version: cached.version,
            etag: cached.etag,
            displayState: .offline,
            logicalDate: cached.logicalDate,
            manual: manual,
            nowMs: cached.fetchedAtMs
        )
        return true
    }

    public func staleDisplayState(current: WidgetDisplayState, fetchedAt: Int64) -> WidgetDisplayState {
        if current == .demo || current == .relink { return current }
        let age = nowMs() - fetchedAt
        return age > Self.staleThresholdMs ? .stale : current
    }
}
