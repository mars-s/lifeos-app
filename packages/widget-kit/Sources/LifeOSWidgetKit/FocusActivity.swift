#if canImport(ActivityKit) && os(iOS)
import ActivityKit
import Foundation

public struct FocusActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        public var start: Date
        public var end: Date?
        public var pausedAt: Date?
        public var plannedMinutes: Double?
        public var round: Int?
        public var kind: String

        public init(start: Date, end: Date?, pausedAt: Date?, plannedMinutes: Double?, round: Int?, kind: String) {
            self.start = start
            self.end = end
            self.pausedAt = pausedAt
            self.plannedMinutes = plannedMinutes
            self.round = round
            self.kind = kind
        }
    }

    public var taskId: String
    public var title: String
    public var areaName: String?
    public var colour: String?

    public init(taskId: String, title: String, areaName: String?, colour: String?) {
        self.taskId = taskId
        self.title = title
        self.areaName = areaName
        self.colour = colour
    }
}
#endif
