import Foundation
import StructuredCore
#if canImport(Security)
import Security
#endif

public struct CredentialStore: Sendable {
    private let defaults: UserDefaults

    public init(defaults: UserDefaults? = nil) {
        self.defaults = defaults
            ?? UserDefaults(suiteName: AppConstants.appGroupID)
            ?? .standard
    }

    public func load() -> Credentials {
        Credentials(
            baseURL: defaults.string(forKey: AppConstants.defaultsURLKey) ?? WidgetStrings.defaultBaseURL,
            discordId: defaults.string(forKey: AppConstants.defaultsDiscordKey) ?? "",
            widgetToken: readToken() ?? ""
        )
    }

    public func isConfigured() -> Bool {
        load().isConfigured
    }

    public func save(_ credentials: Credentials) {
        defaults.set(credentials.baseURL, forKey: AppConstants.defaultsURLKey)
        defaults.set(credentials.discordId, forKey: AppConstants.defaultsDiscordKey)
        if !writeTokenToKeychain(credentials.widgetToken) {
            defaults.set(credentials.widgetToken, forKey: AppConstants.defaultsTokenFallbackKey)
        } else {
            defaults.removeObject(forKey: AppConstants.defaultsTokenFallbackKey)
        }
    }

    public func clear() {
        defaults.removeObject(forKey: AppConstants.defaultsURLKey)
        defaults.removeObject(forKey: AppConstants.defaultsDiscordKey)
        defaults.removeObject(forKey: AppConstants.defaultsTokenFallbackKey)
        deleteTokenFromKeychain()
    }

    private func readToken() -> String? {
        if let keychain = readTokenFromKeychain(), !keychain.isEmpty {
            return keychain
        }
        return defaults.string(forKey: AppConstants.defaultsTokenFallbackKey)
    }

    private func writeTokenToKeychain(_ token: String) -> Bool {
        #if canImport(Security)
        deleteTokenFromKeychain()
        let data = Data(token.utf8)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: AppConstants.keychainService,
            kSecAttrAccount as String: "widget_token",
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
            kSecValueData as String: data,
        ]
        return SecItemAdd(query as CFDictionary, nil) == errSecSuccess
        #else
        return false
        #endif
    }

    private func readTokenFromKeychain() -> String? {
        #if canImport(Security)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: AppConstants.keychainService,
            kSecAttrAccount as String: "widget_token",
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
        #else
        return nil
        #endif
    }

    private func deleteTokenFromKeychain() {
        #if canImport(Security)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: AppConstants.keychainService,
            kSecAttrAccount as String: "widget_token",
        ]
        SecItemDelete(query as CFDictionary)
        #endif
    }
}

public struct SharedWidgetStore: Sendable {
    private let defaults: UserDefaults
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    public init(defaults: UserDefaults? = nil) {
        self.defaults = defaults
            ?? UserDefaults(suiteName: AppConstants.appGroupID)
            ?? .standard
    }

    public func save(cache: WidgetCache) {
        guard let entry = cache.get(),
              let data = try? encoder.encode(entry)
        else { return }
        defaults.set(data, forKey: AppConstants.defaultsCacheKey)
    }

    public func loadCache() -> WidgetCache {
        let cache = WidgetCache()
        if let data = defaults.data(forKey: AppConstants.defaultsCacheKey),
           let entry = try? decoder.decode(WidgetCacheEntry.self, from: data) {
            cache.restore(entry)
        }
        return cache
    }

    public func save(status: ConnectionStatus) {
        if let data = try? encoder.encode(status) {
            defaults.set(data, forKey: AppConstants.defaultsStatusKey)
        }
    }

    public func loadStatus() -> ConnectionStatus {
        guard let data = defaults.data(forKey: AppConstants.defaultsStatusKey),
              let status = try? decoder.decode(ConnectionStatus.self, from: data)
        else { return ConnectionStatus() }
        return status
    }

    public func save(log: String) {
        defaults.set(log, forKey: AppConstants.defaultsLogKey)
    }

    public func loadLog() -> String {
        defaults.string(forKey: AppConstants.defaultsLogKey) ?? ""
    }

    public func clearCacheAndStatus() {
        defaults.removeObject(forKey: AppConstants.defaultsCacheKey)
        defaults.removeObject(forKey: AppConstants.defaultsStatusKey)
        defaults.removeObject(forKey: AppConstants.defaultsLogKey)
    }
}
