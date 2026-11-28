import AppIntents
import Foundation
import Security
import WidgetKit

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

public enum TaskCompleter {
    public static func send(taskId: String, convexUrl: String, token: String) async -> Bool {
        guard let url = URL(string: convexUrl)?.appendingPathComponent("api/mutation") else { return false }
        var request = URLRequest(url: url, timeoutInterval: 8)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let body: [String: Any] = ["path": "planner/tasks:complete", "args": ["taskId": taskId], "format": "json"]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        guard let (data, response) = try? await URLSession.shared.data(for: request),
            (response as? HTTPURLResponse)?.statusCode == 200,
            let reply = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            reply["status"] as? String == "success",
            let value = reply["value"] as? [String: Any]
        else { return false }
        return value["ok"] as? Bool == true
    }
}

public struct TickTaskIntent: AppIntent {
    public static let title: LocalizedStringResource = "Complete a Task"
    public static let isDiscoverable = false

    @Parameter(title: "Task")
    public var taskId: String

    public init() {}

    public init(taskId: String) { self.taskId = taskId }

    public func perform() async throws -> some IntentResult {
        guard let snapshot = WidgetStore.snapshot(), !snapshot.tickedIds.contains(taskId) else { return .result() }
        WidgetStore.save(snapshot.marking(taskId))
        WidgetStore.queue(PendingTick(taskId: taskId, at: Date.now.timeIntervalSince1970 * 1000))
        #if os(iOS)
        if let url = snapshot.convexUrl, let token = SharedToken.read(), SharedToken.isFresh(token),
            await TaskCompleter.send(taskId: taskId, convexUrl: url, token: token)
        {
            WidgetStore.clear([taskId])
        }
        #endif
        WidgetCenter.shared.reloadAllTimelines()
        return .result()
    }
}
