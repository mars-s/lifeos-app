import SwiftUI
import WidgetKit

public struct SnapshotEntry: TimelineEntry {
    public let date: Date
    public let snapshot: WidgetSnapshot?

    public init(date: Date, snapshot: WidgetSnapshot?) {
        self.date = date
        self.snapshot = snapshot
    }
}

public struct SnapshotProvider: TimelineProvider {
    public init() {}

    public func placeholder(in context: Context) -> SnapshotEntry { SnapshotEntry(date: .now, snapshot: nil) }

    public func getSnapshot(in context: Context, completion: @escaping (SnapshotEntry) -> Void) {
        completion(SnapshotEntry(date: .now, snapshot: WidgetStore.snapshot() ?? (context.isPreview ? Sample.snapshot() : nil)))
    }

    public func getTimeline(in context: Context, completion: @escaping (Timeline<SnapshotEntry>) -> Void) {
        let snapshot = WidgetStore.snapshot()
        completion(Self.timeline(snapshot, from: .now))
    }

    public static func timeline(_ snapshot: WidgetSnapshot?, from now: Date) -> Timeline<SnapshotEntry> {
        let calendar = Calendar.current
        let start = calendar.date(bySetting: .second, value: 0, of: now) ?? now
        let first = start > now ? calendar.date(byAdding: .minute, value: -1, to: start) ?? now : start
        let entries = (0..<90).map { offset in
            SnapshotEntry(date: offset == 0 ? now : calendar.date(byAdding: .minute, value: offset, to: first) ?? now, snapshot: snapshot)
        }
        return Timeline(entries: entries, policy: .atEnd)
    }
}

public struct SnapshotTile<Content: View>: View {
    let entry: SnapshotEntry
    let stale: (WidgetSnapshot) -> StaleTile?
    let content: (WidgetSnapshot, Date) -> Content

    public init(
        entry: SnapshotEntry, stale: @escaping (WidgetSnapshot) -> StaleTile? = { _ in nil },
        @ViewBuilder content: @escaping (WidgetSnapshot, Date) -> Content
    ) {
        self.entry = entry
        self.stale = stale
        self.content = content
    }

    public var body: some View {
        InkReader {
            if let snapshot = entry.snapshot {
                if snapshot.isStale(at: entry.date), let tile = stale(snapshot) {
                    tile
                } else {
                    content(snapshot, entry.date)
                }
            } else {
                PlaceholderTile()
            }
        }
    }
}
