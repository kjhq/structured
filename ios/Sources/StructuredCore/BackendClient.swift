import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public struct HTTPRequest: Equatable, Sendable {
    public var method: String
    public var url: String
    public var headers: [String: String]

    public init(method: String, url: String, headers: [String: String] = [:]) {
        self.method = method
        self.url = url
        self.headers = headers
    }
}

public struct HTTPResponse: Equatable, Sendable {
    public var statusCode: Int
    public var headers: [String: String]
    public var body: Data

    public init(statusCode: Int, headers: [String: String] = [:], body: Data = Data()) {
        self.statusCode = statusCode
        self.headers = headers
        self.body = body
    }

    public var headerETag: String? {
        headers.first { $0.key.lowercased() == "etag" }?.value
    }
}

public protocol HTTPTransporting: Sendable {
    func send(_ request: HTTPRequest) async throws -> HTTPResponse
}

public struct BackendClient: SnapshotFetching, MeProbing, Sendable {
    public var credentials: Credentials
    public var transport: any HTTPTransporting

    public init(credentials: Credentials, transport: any HTTPTransporting) {
        self.credentials = credentials
        self.transport = transport
    }

    public func probeMe() async -> ProbeResult {
        guard credentials.isConfigured else {
            return ProbeResult(ok: false, message: "Missing URL, Discord ID, or token")
        }
        let url = credentials.baseURL + "/v1/me"
        let request = authorizedGET(url)
        do {
            let response = try await transport.send(request)
            if !(200..<300).contains(response.statusCode) {
                let snippet = String(data: response.body, encoding: .utf8)?.prefix(100) ?? ""
                let msg = snippet.isEmpty ? "HTTP \(response.statusCode)" : String(snippet)
                return ProbeResult(
                    ok: false,
                    message: "HTTP \(response.statusCode): \(msg)",
                    httpCode: response.statusCode
                )
            }
            let tz = parseTimezone(response.body)
            let msg = tz.map { "Authenticated · timezone \($0)" } ?? "Authenticated"
            return ProbeResult(ok: true, message: msg, httpCode: response.statusCode)
        } catch {
            return ProbeResult(ok: false, message: error.localizedDescription)
        }
    }

    public func fetchSnapshot(ifNoneMatch: String? = nil) async -> SnapshotFetchResult {
        guard credentials.isConfigured else {
            return .error(.network("Base URL not set"))
        }
        let url = credentials.baseURL + "/v1/widget/snapshot"
        var request = authorizedGET(url)
        if let ifNoneMatch, !ifNoneMatch.isEmpty {
            request.headers["If-None-Match"] = ifNoneMatch
        }
        do {
            let response = try await transport.send(request)
            let etag = response.headerETag
            if response.statusCode == 304 {
                return .notModified(etag: etag)
            }
            if response.statusCode == 401 {
                return .error(.unauthorized)
            }
            if !(200..<300).contains(response.statusCode) {
                let snippet = String(data: response.body, encoding: .utf8)?.prefix(120) ?? ""
                return .error(.http(code: response.statusCode, message: String(snippet)))
            }
            do {
                let snapshot = try WidgetSnapshotParser.parse(data: response.body)
                return .ok(snapshot: snapshot, etag: etag)
            } catch {
                return .error(.network("Invalid snapshot JSON"))
            }
        } catch {
            return .error(.network(error.localizedDescription))
        }
    }

    private func authorizedGET(_ url: String) -> HTTPRequest {
        HTTPRequest(
            method: "GET",
            url: url,
            headers: [
                "Accept": "application/json",
                "X-Discord-Id": credentials.discordId,
                "X-Widget-Token": credentials.widgetToken,
            ]
        )
    }

    private func parseTimezone(_ data: Data) -> String? {
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let tz = obj["timezone"] as? String,
              !tz.isEmpty
        else { return nil }
        return tz
    }
}

public struct URLSessionTransport: HTTPTransporting, @unchecked Sendable {
    public var timeout: TimeInterval

    public init(timeout: TimeInterval = 20) {
        self.timeout = timeout
    }

    public func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        guard let url = URL(string: request.url) else {
            throw URLError(.badURL)
        }
        var urlRequest = URLRequest(url: url, timeoutInterval: timeout)
        urlRequest.httpMethod = request.method
        for (key, value) in request.headers {
            urlRequest.setValue(value, forHTTPHeaderField: key)
        }
        let (data, response) = try await urlSessionData(urlRequest)
        guard let http = response as? HTTPURLResponse else {
            throw URLError(.badServerResponse)
        }
        var headers: [String: String] = [:]
        for (key, value) in http.allHeaderFields {
            if let k = key as? String, let v = value as? String {
                headers[k] = v
            }
        }
        return HTTPResponse(statusCode: http.statusCode, headers: headers, body: data)
    }
}

private func urlSessionData(_ request: URLRequest) async throws -> (Data, URLResponse) {
    #if canImport(FoundationNetworking)
    try await withCheckedThrowingContinuation { continuation in
        let task = URLSession.shared.dataTask(with: request) { data, response, error in
            if let error {
                continuation.resume(throwing: error)
                return
            }
            guard let data, let response else {
                continuation.resume(throwing: URLError(.badServerResponse))
                return
            }
            continuation.resume(returning: (data, response))
        }
        task.resume()
    }
    #else
    try await URLSession.shared.data(for: request)
    #endif
}
