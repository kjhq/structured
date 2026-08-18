import SwiftUI
import StructuredCore
#if canImport(UIKit)
import UIKit
#endif

@MainActor
final class SettingsModel: ObservableObject {
    @Published var baseURL: String
    @Published var discordId: String
    @Published var widgetToken: String
    @Published var status: ConnectionStatus
    @Published var logText: String
    @Published var logExpanded = true
    @Published var toast: String?
    @Published var testing = false

    private let credentials = CredentialStore()
    private let store = SharedWidgetStore()
    private var log = AppLogBuffer()

    init() {
        let loaded = credentials.load()
        baseURL = loaded.baseURL.isEmpty ? WidgetStrings.defaultBaseURL : loaded.baseURL
        discordId = loaded.discordId
        widgetToken = loaded.widgetToken
        status = store.loadStatus()
        logText = store.loadLog()
        append("I", "Settings opened · configured=\(loaded.isConfigured)")
    }

    var currentCredentials: Credentials {
        Credentials(baseURL: baseURL, discordId: discordId, widgetToken: widgetToken)
    }

    var chip: ConnectionState {
        status.state(configured: currentCredentials.isConfigured)
    }

    func save() {
        let creds = currentCredentials
        guard creds.isConfigured else {
            toast = "Fill URL, Discord ID, and token"
            return
        }
        credentials.save(creds)
        status.invalidateAfterCredentialChange()
        store.save(status: status)
        append("I", "Credentials saved · url=\(creds.baseURL) discord=\(creds.discordId)")
        toast = "Saved — tap Test connection to verify"
    }

    func test() async {
        let creds = currentCredentials
        guard creds.isConfigured else {
            toast = "Fill URL, Discord ID, and token first"
            return
        }
        credentials.save(creds)
        status.invalidateAfterCredentialChange()
        store.save(status: status)
        testing = true
        append("I", "Testing connection…")
        let result = await WidgetSync.probe(credentials: creds, store: store)
        status = store.loadStatus()
        if result.ok {
            append("I", result.message)
            toast = result.message
            _ = await WidgetSync.refresh(manual: true, credentials: creds, store: store)
            status = store.loadStatus()
        } else {
            append("W", "Probe failed — \(result.message)")
            toast = "Failed: \(result.message)"
        }
        testing = false
    }

    func refreshWidgets() async {
        guard currentCredentials.isConfigured else {
            toast = "Save credentials first"
            return
        }
        credentials.save(currentCredentials)
        append("I", "Manual widget refresh enqueued")
        toast = "Refreshing widgets…"
        _ = await WidgetSync.refresh(manual: true, credentials: currentCredentials, store: store)
        status = store.loadStatus()
    }

    func disconnect() {
        credentials.clear()
        status.clear()
        store.save(status: status)
        store.clearCacheAndStatus()
        discordId = ""
        widgetToken = ""
        append("W", "Credentials cleared — widgets will use sample data")
        toast = "Credentials cleared"
        Task { _ = await WidgetSync.refresh(manual: true, credentials: currentCredentials, store: store) }
    }

    func copyLog() {
        #if canImport(UIKit)
        UIPasteboard.general.string = logText
        #endif
        toast = logText.isEmpty ? "Log is empty" : "Log copied"
    }

    private func append(_ level: String, _ message: String) {
        log.append(level: level, message: message)
        logText = log.snapshot
        store.save(log: logText)
    }
}

struct SettingsView: View {
    @StateObject private var model = SettingsModel()

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    header
                    statusCard
                    credentialsCard
                    logCard
                    Text(WidgetStrings.setupSteps)
                        .font(.footnote)
                        .foregroundStyle(Color.white.opacity(0.4))
                        .padding(.bottom, 24)
                }
                .padding(20)
            }
            .background(Color(red: 13 / 255, green: 13 / 255, blue: 13 / 255).ignoresSafeArea())
        }
        .tint(accent)
    }

    private var accent: Color {
        Color(red: 94 / 255, green: 150 / 255, blue: 203 / 255)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(WidgetStrings.appName)
                .font(.system(size: 24, weight: .bold))
                .foregroundStyle(Color.white.opacity(0.95))
            Text(WidgetStrings.settingsSubtitle)
                .font(.system(size: 14))
                .foregroundStyle(Color.white.opacity(0.6))
        }
        .padding(.top, 8)
    }

    private var statusCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(model.chip.chipLabel)
                .font(.system(size: 10, weight: .medium))
                .tracking(0.6)
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
                .background(chipColor.opacity(0.2), in: Capsule())
                .foregroundStyle(Color.white.opacity(0.95))

            if model.currentCredentials.isConfigured {
                Text("URL · \(model.currentCredentials.baseURL)")
                Text("Discord · \(model.currentCredentials.discordId)")
                Text("Token · \(model.currentCredentials.maskedToken)")
            }

            if let probe = model.status.probe {
                let mark = probe.ok ? "OK" : "FAIL"
                Text("API check · \(mark) · \(ConnectionStatus.formatTime(probe.atEpochMs))\n\(probe.message)")
            } else {
                Text("API check · never run")
            }

            if let refresh = model.status.refresh {
                let mark = refresh.ok ? "OK" : "FAIL"
                Text("Widget refresh · \(mark) · \(ConnectionStatus.formatTime(refresh.atEpochMs))\n\(refresh.message)")
            } else {
                Text("Widget refresh · never")
            }
        }
        .font(.system(size: 13))
        .foregroundStyle(Color.white.opacity(0.6))
        .card()
    }

    private var chipColor: Color {
        switch model.chip {
        case .notConfigured: return .white
        case .savedUntested: return Color(red: 247 / 255, green: 183 / 255, blue: 49 / 255)
        case .ok: return Color(red: 38 / 255, green: 222 / 255, blue: 129 / 255)
        case .failing: return Color(red: 235 / 255, green: 59 / 255, blue: 90 / 255)
        }
    }

    private var credentialsCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            labeledField("Backend URL", text: $model.baseURL, hint: WidgetStrings.helperBackendURL)
            labeledField("Discord user ID", text: $model.discordId)
            labeledField("Widget token", text: $model.widgetToken, hint: WidgetStrings.helperWidgetToken, secret: true)

            Button(model.testing ? "Testing…" : "Test connection") {
                Task { await model.test() }
            }
            .buttonStyle(.borderedProminent)
            .disabled(model.testing)
            .frame(maxWidth: .infinity)

            Button("Save") { model.save() }
                .buttonStyle(.bordered)
                .frame(maxWidth: .infinity)

            HStack {
                Button("Refresh widgets") {
                    Task { await model.refreshWidgets() }
                }
                Spacer()
                Button("Clear credentials") { model.disconnect() }
            }
            .font(.subheadline)
        }
        .card()
    }

    private var logCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Log").font(.subheadline.bold()).foregroundStyle(Color.white.opacity(0.95))
                Spacer()
                Button("Copy log") { model.copyLog() }
                Button(model.logExpanded ? "Hide log" : "Show log") {
                    model.logExpanded.toggle()
                }
            }
            .font(.subheadline)
            if model.logExpanded {
                ScrollView {
                    Text(model.logText.isEmpty ? "(no log lines yet)" : model.logText)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(Color.white.opacity(0.6))
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(height: 160)
            }
        }
        .card()
    }

    private func labeledField(
        _ title: String,
        text: Binding<String>,
        hint: String? = nil,
        secret: Bool = false
    ) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.caption)
                .foregroundStyle(Color.white.opacity(0.6))
            if secret {
                SecureField(title, text: text)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            } else {
                TextField(title, text: text)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            }
            if let hint {
                Text(hint).font(.caption2).foregroundStyle(Color.white.opacity(0.4))
            }
        }
    }
}

private extension View {
    func card() -> some View {
        self
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(Color.white.opacity(0.06))
                    .overlay(
                        RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .stroke(Color.white.opacity(0.08), lineWidth: 0.5)
                    )
            )
    }
}
