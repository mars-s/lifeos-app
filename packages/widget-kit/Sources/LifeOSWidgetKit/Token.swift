import Foundation
import Security

public enum SharedToken {
    private static func query() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: WidgetStore.tokenService,
            kSecAttrAccount as String: WidgetStore.tokenAccount,
            kSecAttrAccessGroup as String: WidgetStore.keychainGroup,
            kSecUseDataProtectionKeychain as String: true,
        ]
    }

    public static func read() -> String? {
        var request = query()
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(request as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    @discardableResult
    public static func write(_ token: String?) -> Bool {
        SecItemDelete(query() as CFDictionary)
        guard let token, let data = token.data(using: .utf8) else { return true }
        var item = query()
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        return SecItemAdd(item as CFDictionary, nil) == errSecSuccess
    }

    public static func isFresh(_ token: String, at now: Date = .now) -> Bool {
        let parts = token.split(separator: ".")
        guard parts.count == 3 else { return false }
        var payload = String(parts[1]).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        payload += String(repeating: "=", count: (4 - payload.count % 4) % 4)
        guard let data = Data(base64Encoded: payload),
            let claims = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let expiry = claims["exp"] as? Double
        else { return false }
        return expiry > now.timeIntervalSince1970 + 30
    }
}
