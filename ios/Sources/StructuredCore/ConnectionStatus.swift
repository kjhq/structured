import Foundation

public struct CheckResult: Equatable, Codable, Sendable {
    public var ok: Bool
    public var message: String
    public var atEpochMs: Int64

    public init(ok: Bool, message: String, atEpochMs: Int64) {
        self.ok = ok
        self.message = message
        self.atEpochMs = atEpochMs
    }
}

public enum ConnectionState: String, Equatable, Sendable {
    case notConfigured
    case savedUntested
    case ok
    case failing

    public var chipLabel: String {
        switch self {
        case .notConfigured: return "Not configured"
        case .savedUntested: return "Saved — test connection"
        case .ok: return "Connected"
        case .failing: return "Connection issue"
        }
    }
}

public struct ConnectionStatus: Equatable, Codable, Sendable {
    public var probe: CheckResult?
    public var refresh: CheckResult?

    public init(probe: CheckResult? = nil, refresh: CheckResult? = nil) {
        self.probe = probe
        self.refresh = refresh
    }

    public mutating func recordProbe(ok: Bool, message: String, at: Int64) {
        probe = CheckResult(ok: ok, message: message, atEpochMs: at)
    }

    public mutating func recordRefresh(ok: Bool, message: String, at: Int64) {
        refresh = CheckResult(ok: ok, message: message, atEpochMs: at)
    }

    public mutating func invalidateAfterCredentialChange() {
        probe = nil
        refresh = nil
    }

    public mutating func clear() {
        probe = nil
        refresh = nil
    }

    public func state(configured: Bool) -> ConnectionState {
        if !configured { return .notConfigured }
        guard let probe else { return .savedUntested }
        if !probe.ok { return .failing }
        if let refresh, !refresh.ok { return .failing }
        return .ok
    }

    public static func formatTime(_ epochMs: Int64) -> String {
        let date = Date(timeIntervalSince1970: TimeInterval(epochMs) / 1000)
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "MMM d HH:mm:ss"
        return formatter.string(from: date)
    }
}

public struct AppLogBuffer: Sendable {
    public static let maxLines = 80
    private var lines: [String] = []

    public init() {}

    public mutating func append(level: String, message: String, at: Date = Date()) {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "HH:mm:ss"
        lines.append("\(formatter.string(from: at)) \(level) \(message)")
        if lines.count > Self.maxLines {
            lines.removeFirst(lines.count - Self.maxLines)
        }
    }

    public var snapshot: String {
        lines.joined(separator: "\n")
    }
}
