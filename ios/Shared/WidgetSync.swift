import Foundation
import StructuredCore
#if canImport(WidgetKit)
import WidgetKit
#endif

public enum WidgetSync {
    public static func makeClient(credentials: Credentials) -> BackendClient {
        BackendClient(credentials: credentials, transport: URLSessionTransport())
    }

    public static func refresh(
        manual: Bool,
        credentials: Credentials? = nil,
        store: SharedWidgetStore = SharedWidgetStore(),
        now: Date = Date()
    ) async -> RefreshOutcome {
        let creds = credentials ?? CredentialStore().load()
        let cache = store.loadCache()
        let nowMs = Int64(now.timeIntervalSince1970 * 1000)
        let coord = WidgetRefreshCoordinator(
            cache: cache,
            nowMs: { nowMs }
        )
        let outcome = await coord.refresh(
            configured: creds.isConfigured,
            fetcher: makeClient(credentials: creds),
            manual: manual
        )
        store.save(cache: coord.cache)
        var status = store.loadStatus()
        status.recordRefresh(ok: outcome.ok, message: outcome.message, at: nowMs)
        store.save(status: status)
        #if canImport(WidgetKit)
        WidgetCenter.shared.reloadAllTimelines()
        #endif
        return outcome
    }

    public static func probe(
        credentials: Credentials,
        store: SharedWidgetStore = SharedWidgetStore(),
        now: Date = Date()
    ) async -> ProbeResult {
        let result = await makeClient(credentials: credentials).probeMe()
        var status = store.loadStatus()
        status.recordProbe(
            ok: result.ok,
            message: result.message,
            at: Int64(now.timeIntervalSince1970 * 1000)
        )
        store.save(status: status)
        return result
    }
}
