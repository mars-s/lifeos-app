import Foundation

public struct WidgetSnapshot: Codable, Sendable, Equatable {
    public struct WorkingHours: Codable, Sendable, Equatable {
        public var startMinute: Double
        public var endMinute: Double
    }

    public struct Area: Codable, Sendable, Equatable {
        public var name: String
        public var colour: String
    }

    public struct Task: Codable, Sendable, Equatable, Identifiable {
        public var id: String
        public var title: String
        public var area: Area?
        public var estimateMinutes: Double?
    }

    public struct Trip: Codable, Sendable, Equatable {
        public var place: String
        public var minutes: Double
    }

    public struct Block: Codable, Sendable, Equatable, Identifiable {
        public var id: String
        public var taskId: String
        public var title: String
        public var start: Double
        public var minutes: Double
        public var done: Bool
        public var area: Area?
        public var trip: Trip?

        public var end: Double { start + minutes * 60_000 }
    }

    public struct Commitment: Codable, Sendable, Equatable, Identifiable {
        public var id: String
        public var title: String
        public var start: Double
        public var end: Double
    }

    public struct Focus: Codable, Sendable, Equatable {
        public var taskId: String
        public var title: String
        public var kind: String
        public var start: Double
        public var pausedMs: Double
        public var pausedAt: Double?
        public var plannedMinutes: Double?
        public var round: Double?
        public var colour: String?
    }

    public struct Slice: Codable, Sendable, Equatable {
        public var id: String?
        public var colour: String?
        public var minutes: Double
    }

    public struct Day: Codable, Sendable, Equatable, Identifiable {
        public var date: String
        public var capacityMinutes: Double
        public var plannedMinutes: Double
        public var slices: [Slice]
        public var deadlines: Int

        public var id: String { date }
    }

    public struct Deadline: Codable, Sendable, Equatable, Identifiable {
        public var id: String
        public var title: String
        public var date: String
        public var area: Area?
    }

    public var v: Int
    public var writtenAt: Double
    public var convexUrl: String?
    public var date: String
    public var timeZone: String
    public var workingHours: WorkingHours
    public var capacityMinutes: Double
    public var plannedMinutes: Double
    public var tasksLeft: Int
    public var tasks: [Task]
    public var blocks: [Block]
    public var commitments: [Commitment]
    public var focus: Focus?
    public var week: [Day]
    public var deadlines: [Deadline]
    public var brainDump: Int
    public var ticked: [String]?

    public static func decode(_ data: Data) throws -> WidgetSnapshot {
        try JSONDecoder().decode(WidgetSnapshot.self, from: data)
    }

    public func encoded() throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return try encoder.encode(self)
    }
}

public struct Span: Sendable, Equatable, Identifiable {
    public enum Kind: Sendable, Equatable { case block, commitment, trip }
    public var id: String
    public var start: Double
    public var end: Double
    public var kind: Kind
    public var colour: String?
}

public enum CapacityState: String, Sendable {
    case roomy, steady, tight, full, over
}

public struct DayClock: Sendable {
    public let calendar: Calendar

    public init(timeZone: String) {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: timeZone) ?? .current
        calendar.locale = Locale(identifier: "en_AU")
        self.calendar = calendar
    }

    public func minute(of instant: Date) -> Double {
        let settled = Date(timeIntervalSince1970: instant.timeIntervalSince1970.rounded())
        let parts = calendar.dateComponents([.hour, .minute, .second], from: settled)
        return Double((parts.hour ?? 0) * 60 + (parts.minute ?? 0)) + Double(parts.second ?? 0) / 60
    }

    public func minute(ofMs ms: Double) -> Double {
        minute(of: Date(timeIntervalSince1970: ms / 1000))
    }

    public func isoDate(of instant: Date) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: instant)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    public func date(iso: String) -> Date? {
        let parts = iso.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: 12))
    }

    public func moment(iso: String, minute: Double) -> Date? {
        guard let noon = date(iso: iso), let midnight = calendar.date(bySettingHour: 0, minute: 0, second: 0, of: noon) else { return nil }
        return midnight.addingTimeInterval(minute * 60)
    }

    public func days(from: String, to: String) -> Int {
        guard let start = date(iso: from), let end = date(iso: to) else { return 0 }
        return calendar.dateComponents([.day], from: start, to: end).day ?? 0
    }

    public func format(iso: String, _ template: String) -> String {
        guard let day = date(iso: iso) else { return iso }
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.locale = calendar.locale
        formatter.dateFormat = template
        return formatter.string(from: day)
    }
}

public extension WidgetSnapshot {
    var clock: DayClock { DayClock(timeZone: timeZone) }

    func isStale(at now: Date) -> Bool { clock.isoDate(of: now) != date }

    var tickedIds: Set<String> { Set(ticked ?? []) }

    var openTasks: [Task] { tasks.filter { !tickedIds.contains($0.id) } }

    var tasksLeftNow: Int { max(0, tasksLeft - tasks.filter { tickedIds.contains($0.id) }.count) }

    var tickedMinutes: Double {
        tasks.filter { tickedIds.contains($0.id) }.reduce(0) { $0 + ($1.estimateMinutes ?? 0) }
    }

    var openPlannedMinutes: Double { max(0, plannedMinutes - tickedMinutes) }

    func freeMinutesAhead(at now: Date) -> Double {
        let clock = self.clock
        guard let dayStart = clock.moment(iso: date, minute: 0) else { return 0 }
        let base = dayStart.timeIntervalSince1970 * 1000
        let windowStart = base + workingHours.startMinute * 60_000
        let windowEnd = base + workingHours.endMinute * 60_000
        let from = max(windowStart, now.timeIntervalSince1970 * 1000)
        guard windowEnd > from else { return 0 }
        let busy = Self.merged(commitments.map { (max($0.start, from), min($0.end, windowEnd)) }.filter { $0.1 > $0.0 })
            .reduce(0) { $0 + ($1.1 - $1.0) }
        return (windowEnd - from - busy) / 60_000
    }

    private static func merged(_ intervals: [(Double, Double)]) -> [(Double, Double)] {
        intervals.sorted { $0.0 < $1.0 }.reduce(into: [(Double, Double)]()) { result, next in
            if let last = result.last, next.0 <= last.1 {
                result[result.count - 1].1 = max(last.1, next.1)
            } else {
                result.append(next)
            }
        }
    }

    func capacityAhead(at now: Date) -> Double {
        let ahead = freeMinutesAhead(at: now).rounded()
        return clock.isoDate(of: now) == date ? min(capacityMinutes, ahead) : capacityMinutes
    }

    func capacityLeft(at now: Date) -> Double {
        (capacityAhead(at: now) - openPlannedMinutes).rounded()
    }

    func capacityState(at now: Date) -> CapacityState {
        let left = capacityLeft(at: now)
        if left < 0 { return .over }
        if left == 0 { return .full }
        if left < 60 { return .tight }
        return left > capacityAhead(at: now) / 2 ? .roomy : .steady
    }

    func spans() -> [Span] {
        let clock = self.clock
        let blockSpans = blocks.map {
            Span(id: $0.id, start: clock.minute(ofMs: $0.start), end: clock.minute(ofMs: $0.start) + $0.minutes, kind: .block, colour: $0.area?.colour)
        }
        let trips = blocks.compactMap { block -> Span? in
            guard let trip = block.trip, trip.minutes > 0 else { return nil }
            let start = clock.minute(ofMs: block.start)
            return Span(id: "trip-\(block.id)", start: start - trip.minutes, end: start, kind: .trip)
        }
        let busy = commitments.map {
            Span(id: $0.id, start: clock.minute(ofMs: $0.start), end: clock.minute(ofMs: $0.end), kind: .commitment)
        }
        return trips + blockSpans + busy
    }

    func nextBlock(after now: Date) -> Block? {
        let ms = now.timeIntervalSince1970 * 1000
        return blocks.filter { !$0.done && $0.start > ms && !tickedIds.contains($0.taskId) }.min { $0.start < $1.start }
    }

    func leaveMs(for block: Block) -> Double? {
        block.trip.map { block.start - $0.minutes * 60_000 }
    }

    var todaySlices: [Slice] { (week.first?.slices ?? []).filter { $0.id.map { !tickedIds.contains($0) } ?? true } }

    var weekFreeMinutes: Double {
        week.reduce(0) { $0 + max(0, $1.capacityMinutes - $1.plannedMinutes) }
    }

    func daysUntil(_ deadline: Deadline) -> Int { clock.days(from: date, to: deadline.date) }

    func marking(_ taskId: String) -> WidgetSnapshot {
        var copy = self
        copy.ticked = Array(tickedIds.union([taskId])).sorted()
        return copy
    }
}

public extension WidgetSnapshot.Focus {
    var isPaused: Bool { pausedAt != nil }

    var countsDown: Bool { plannedMinutes != nil }

    func elapsedMs(at now: Date) -> Double {
        let until = pausedAt ?? now.timeIntervalSince1970 * 1000
        return max(0, until - start - pausedMs)
    }

    func remainingMs(at now: Date) -> Double {
        guard let planned = plannedMinutes else { return 0 }
        return max(0, planned * 60_000 - elapsedMs(at: now))
    }

    var endDate: Date? {
        guard let planned = plannedMinutes, pausedAt == nil else { return nil }
        return Date(timeIntervalSince1970: (start + pausedMs + planned * 60_000) / 1000)
    }

    var effectiveStart: Date { Date(timeIntervalSince1970: (start + pausedMs) / 1000) }
}
