import XCTest
import StructuredCore

private struct MockFetcher: SnapshotFetching {
    var result: SnapshotFetchResult
    func fetchSnapshot(ifNoneMatch: String?) async -> SnapshotFetchResult { result }
}

private actor RecordingFetcher: SnapshotFetching {
    var ifNoneMatches: [String?] = []
    var result: SnapshotFetchResult
    init(result: SnapshotFetchResult) { self.result = result }
    func fetchSnapshot(ifNoneMatch: String?) async -> SnapshotFetchResult {
        ifNoneMatches.append(ifNoneMatch)
        return result
    }
}

final class WidgetRefreshTests: XCTestCase {
    private let today = DayDate(year: 2026, month: 7, day: 6)
    private let now = ClockTime(hour: 10, minute: 0)

    private func coordinator(nowMs: Int64 = 1_000) -> WidgetRefreshCoordinator {
        WidgetRefreshCoordinator(
            cache: WidgetCache(),
            nowMs: { nowMs },
            todayRepo: TodayRepository(now: { self.now }, deviceTimeZoneId: { "UTC" }),
            weekRepo: WeekRepository(),
            demoToday: { self.today },
            demoTimeZone: { "UTC" }
        )
    }

    private func snapshot(version: String = "v1", dueTitle: String = "Overdue") -> WidgetSnapshot {
        WidgetSnapshot(
            logicalDate: today,
            timezone: "UTC",
            dayStartsAt: ClockTime(hour: 4, minute: 0),
            generatedAt: "",
            version: version,
            today: [StructuredTask(id: "a", title: "Lunch", day: "2026-07-06", startTime: 12.0, duration: 60)],
            inbox: [],
            due: [StructuredTask(id: "d1", title: dueTitle, day: "2026-07-04", startTime: 9.0, duration: 30)],
            tomorrow: [],
            week: [StructuredTask(id: "w", title: "Dinner", day: "2026-07-08", startTime: 19.0, duration: 60)]
        )
    }

    func testRefreshFromBackendAppliesTodayAndWeek() async {
        let coord = coordinator()
        let outcome = await coord.refreshFromBackend(
            fetcher: MockFetcher(result: .ok(snapshot: snapshot(), etag: "\"v1\"")),
            manual: true
        )
        XCTAssertTrue(outcome.ok)
        XCTAssertEqual(coord.cache.get()?.todayState.hero?.title, "Lunch")
        XCTAssertEqual(coord.cache.get()?.todayState.due.first?.title, "Overdue")
        XCTAssertEqual(coord.cache.get()?.weekState.days.count, 8)
        let wednesday = coord.cache.get()?.weekState.days.first { $0.date == DayDate(year: 2026, month: 7, day: 8) }
        XCTAssertEqual(wednesday?.timed.first?.title, "Dinner")
        XCTAssertEqual(coord.cache.get()?.displayState, .live)
    }

    func testRefreshDemoWithoutCredentials() async {
        let coord = coordinator()
        let outcome = await coord.refresh(configured: false, fetcher: MockFetcher(result: .error(.network("no"))), manual: false)
        XCTAssertTrue(outcome.ok)
        XCTAssertEqual(coord.cache.get()?.displayState, .demo)
        XCTAssertFalse(coord.cache.get()?.todayState.inbox.isEmpty ?? true)
    }

    func testUnauthorizedMarksRelinkAndKeepsCache() async {
        let coord = coordinator()
        _ = await coord.refreshFromBackend(
            fetcher: MockFetcher(result: .ok(snapshot: snapshot(), etag: "e1")),
            manual: true
        )
        let outcome = await coord.refreshFromBackend(
            fetcher: MockFetcher(result: .error(.unauthorized)),
            manual: false
        )
        XCTAssertEqual(outcome, .authFailure("Auth failed — re-link in Discord"))
        XCTAssertEqual(coord.cache.get()?.displayState, .relink)
        XCTAssertEqual(coord.cache.get()?.todayState.hero?.title, "Lunch")
    }

    func testTransientFailureShowsOfflineWhenCacheExists() async {
        let coord = coordinator()
        _ = await coord.refreshFromBackend(
            fetcher: MockFetcher(result: .ok(snapshot: snapshot(), etag: "e1")),
            manual: true
        )
        let outcome = await coord.refreshFromBackend(
            fetcher: MockFetcher(result: .error(.network("offline"))),
            manual: false
        )
        XCTAssertEqual(outcome, .success("Offline — showing cached data"))
        XCTAssertEqual(coord.cache.get()?.displayState, .offline)
    }

    func testTransientFailureWithoutCacheReturnsFailure() async {
        let coord = coordinator()
        let outcome = await coord.refreshFromBackend(
            fetcher: MockFetcher(result: .error(.http(code: 500, message: "boom"))),
            manual: false
        )
        XCTAssertEqual(outcome, .transientFailure("HTTP 500: boom"))
        XCTAssertNil(coord.cache.get())
    }

    func testNotModifiedKeepsDataAndCanMarkStale() async {
        let cache = WidgetCache()
        let fresh = WidgetRefreshCoordinator(
            cache: cache,
            nowMs: { 1_000 },
            todayRepo: TodayRepository(now: { self.now }, deviceTimeZoneId: { "UTC" }),
            demoToday: { self.today },
            demoTimeZone: { "UTC" }
        )
        _ = await fresh.refreshFromBackend(
            fetcher: MockFetcher(result: .ok(snapshot: snapshot(), etag: "e1")),
            manual: true
        )
        let later = WidgetRefreshCoordinator(
            cache: cache,
            nowMs: { 1_000 + WidgetRefreshCoordinator.staleThresholdMs + 1 },
            todayRepo: TodayRepository(now: { self.now }, deviceTimeZoneId: { "UTC" }),
            demoToday: { self.today },
            demoTimeZone: { "UTC" }
        )
        let outcome = await later.refreshFromBackend(
            fetcher: MockFetcher(result: .notModified(etag: "e1")),
            manual: false
        )
        XCTAssertTrue(outcome.ok)
        XCTAssertEqual(cache.get()?.displayState, .stale)
    }

    func testManualRefreshOmitsETag() async {
        let fetcher = RecordingFetcher(result: .ok(snapshot: snapshot(), etag: "e1"))
        let coord = coordinator()
        coord.cache.forceSet(
            todayState: TodayState(),
            weekState: WeekState(days: []),
            version: "old",
            etag: "old-etag",
            displayState: .live,
            logicalDate: today,
            nowMs: 1
        )
        _ = await coord.refreshFromBackend(fetcher: fetcher, manual: true)
        let matches = await fetcher.ifNoneMatches
        XCTAssertEqual(matches, [nil])
    }
}

private final class ScriptedTransport: HTTPTransporting, @unchecked Sendable {
    var responses: [HTTPResponse]
    var requests: [HTTPRequest] = []
    init(_ responses: [HTTPResponse]) { self.responses = responses }
    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        requests.append(request)
        return responses.removeFirst()
    }
}

final class BackendClientTests: XCTestCase {
    private let creds = Credentials(
        baseURL: "http://127.0.0.1:8003/",
        discordId: "123",
        widgetToken: "wt_secret_token"
    )

    func testCredentialsTrimTrailingSlash() {
        XCTAssertEqual(creds.baseURL, "http://127.0.0.1:8003")
        XCTAssertEqual(creds.maskedToken, "wt_sec…oken")
    }

    func testProbeMeSuccessReadsTimezone() async {
        let body = #"{"timezone":"Asia/Kolkata"}"#.data(using: .utf8)!
        let transport = ScriptedTransport([HTTPResponse(statusCode: 200, body: body)])
        let client = BackendClient(credentials: creds, transport: transport)
        let result = await client.probeMe()
        XCTAssertTrue(result.ok)
        XCTAssertEqual(result.message, "Authenticated · timezone Asia/Kolkata")
        XCTAssertEqual(transport.requests.first?.headers["X-Discord-Id"], "123")
        XCTAssertEqual(transport.requests.first?.headers["X-Widget-Token"], "wt_secret_token")
        XCTAssertTrue(transport.requests.first?.url.hasSuffix("/v1/me") == true)
    }

    func testFetchSnapshot304() async {
        let transport = ScriptedTransport([
            HTTPResponse(statusCode: 304, headers: ["ETag": "\"abc\""]),
        ])
        let client = BackendClient(credentials: creds, transport: transport)
        let result = await client.fetchSnapshot(ifNoneMatch: "\"abc\"")
        XCTAssertEqual(result, .notModified(etag: "\"abc\""))
        XCTAssertEqual(transport.requests.first?.headers["If-None-Match"], "\"abc\"")
    }

    func testFetchSnapshot401() async {
        let transport = ScriptedTransport([HTTPResponse(statusCode: 401)])
        let client = BackendClient(credentials: creds, transport: transport)
        let result = await client.fetchSnapshot()
        XCTAssertEqual(result, .error(.unauthorized))
    }

    func testFetchSnapshotParsesBody() async throws {
        let json = """
        {"logical_date":"2026-07-06","timezone":"UTC","day_starts_at":"04:00:00","generated_at":"","version":"v1","today":[],"inbox":[],"due":[],"tomorrow":[],"week":[]}
        """.data(using: .utf8)!
        let transport = ScriptedTransport([
            HTTPResponse(statusCode: 200, headers: ["ETag": "\"v1\""], body: json),
        ])
        let client = BackendClient(credentials: creds, transport: transport)
        let result = await client.fetchSnapshot()
        guard case .ok(let snap, let etag) = result else {
            return XCTFail("expected ok, got \(result)")
        }
        XCTAssertEqual(snap.version, "v1")
        XCTAssertEqual(etag, "\"v1\"")
    }
}

final class ConnectionStatusTests: XCTestCase {
    func testStateMachine() {
        var status = ConnectionStatus()
        XCTAssertEqual(status.state(configured: false), .notConfigured)
        XCTAssertEqual(status.state(configured: true), .savedUntested)
        status.recordProbe(ok: true, message: "ok", at: 1)
        XCTAssertEqual(status.state(configured: true), .ok)
        status.recordRefresh(ok: false, message: "fail", at: 2)
        XCTAssertEqual(status.state(configured: true), .failing)
        status.invalidateAfterCredentialChange()
        XCTAssertEqual(status.state(configured: true), .savedUntested)
    }
}
