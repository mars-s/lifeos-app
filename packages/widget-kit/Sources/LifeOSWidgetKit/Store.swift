import Foundation

public struct PendingTick: Codable, Sendable, Equatable {
    public var taskId: String
    public var at: Double
}

public enum WidgetStore {
    #if os(macOS)
    public static let appGroup = "BFKXU8H6X5.com.marss.lifeos"
    #else
    public static let appGroup = "group.com.marss.lifeos"
    #endif

    public static let keychainGroup = "BFKXU8H6X5.com.marss.lifeos.shared"
    public static let tokenAccount = "convex-jwt"
    public static let tokenService = "com.marss.lifeos.widgets"

    public static var folder: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)
    }

    static func file(_ name: String) -> URL? { folder?.appendingPathComponent(name) }

    public static func snapshot() -> WidgetSnapshot? {
        guard let url = file("snapshot.json"), let data = try? Data(contentsOf: url) else { return nil }
        return try? WidgetSnapshot.decode(data)
    }

    public static func save(_ snapshot: WidgetSnapshot) {
        guard let url = file("snapshot.json"), let data = try? snapshot.encoded() else { return }
        try? data.write(to: url, options: .atomic)
    }

    public static func writeRaw(_ json: Data) throws {
        guard let url = file("snapshot.json") else { throw CocoaError(.fileNoSuchFile) }
        let decoded = try WidgetSnapshot.decode(json)
        var merged = decoded
        let pending = Set(pendingTicks().map(\.taskId))
        let stillListed = decoded.tasks.map(\.id).filter { pending.contains($0) }
        merged.ticked = stillListed.isEmpty ? nil : stillListed.sorted()
        try merged.encoded().write(to: url, options: .atomic)
    }

    public static func pendingTicks() -> [PendingTick] {
        guard let url = file("ticks.json"), let data = try? Data(contentsOf: url) else { return [] }
        return (try? JSONDecoder().decode([PendingTick].self, from: data)) ?? []
    }

    public static func queue(_ tick: PendingTick) {
        let ticks = pendingTicks().filter { $0.taskId != tick.taskId } + [tick]
        writeTicks(ticks)
    }

    public static func clear(_ taskIds: [String]) {
        let gone = Set(taskIds)
        writeTicks(pendingTicks().filter { !gone.contains($0.taskId) })
    }

    static func writeTicks(_ ticks: [PendingTick]) {
        guard let url = file("ticks.json"), let data = try? JSONEncoder().encode(ticks) else { return }
        try? data.write(to: url, options: .atomic)
    }
}
