import SwiftUI
import WidgetKit

@main
struct LifeOSWidgetBundle: WidgetBundle {
    var body: some Widget {
        TodayWidget()
        CapacityWidget()
        NextUpWidget()
        FocusWidget()
        UpcomingWidget()
        BrainDumpWidget()
        FocusLiveActivity()
        if #available(iOS 18.0, *) {
            BrainDumpControl()
        }
    }
}

private extension WidgetConfiguration {
    func tile() -> some WidgetConfiguration {
        contentMarginsDisabled()
    }
}

struct Framed<Content: View>: View {
    @Environment(\.widgetFamily) private var family
    let content: Content

    init(@ViewBuilder content: () -> Content) { self.content = content() }

    var body: some View {
        switch family {
        case .accessoryCircular, .accessoryRectangular, .accessoryInline:
            content.containerBackground(for: .widget) { AccessoryWidgetBackground() }
        default:
            content.padding(14).containerBackground(for: .widget) { TileBackground() }
        }
    }
}

struct TodayWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "today", provider: SnapshotProvider()) { entry in
            Framed { TodayView(entry: entry) }.widgetURL(Links.today)
        }
        .configurationDisplayName("Today")
        .description("Tasks left today. Tick one without opening LifeOS.")
        .supportedFamilies([.systemMedium, .systemLarge, .accessoryCircular, .accessoryInline])
        .tile()
    }
}

struct TodayView: View {
    @Environment(\.widgetFamily) private var family
    let entry: SnapshotEntry

    var body: some View {
        switch family {
        case .accessoryCircular:
            InkReader { TodayCircle(snapshot: entry.snapshot) }
        case .accessoryInline:
            TodayInline(snapshot: entry.snapshot, now: entry.date)
        default:
            SnapshotTile(entry: entry, stale: { snapshot in
                StaleTile(title: "Today", snapshot: snapshot, figure: String(snapshot.tasksLeftNow), symbol: "checkmark.circle.fill", unit: "left")
            }) { snapshot, now in
                TodayTile(snapshot: snapshot, now: now, large: family == .systemLarge)
            }
        }
    }
}

struct CapacityWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "capacity", provider: SnapshotProvider()) { entry in
            Framed { CapacityView(entry: entry) }.widgetURL(Links.today)
        }
        .configurationDisplayName("Capacity")
        .description("Free time still ahead of you today, over the day.")
        .supportedFamilies([.systemSmall, .accessoryCircular])
        .tile()
    }
}

struct CapacityView: View {
    @Environment(\.widgetFamily) private var family
    let entry: SnapshotEntry

    var body: some View {
        if family == .accessoryCircular {
            InkReader { CapacityCircle(snapshot: entry.snapshot, now: entry.date) }
        } else {
            SnapshotTile(entry: entry, stale: { snapshot in
                StaleTile(
                    title: "Capacity", snapshot: snapshot, figure: Format.minutes(max(0, snapshot.capacityMinutes - snapshot.plannedMinutes)),
                    symbol: "hourglass", unit: "h:m")
            }) { snapshot, now in
                CapacityTile(snapshot: snapshot, now: now)
            }
        }
    }
}

struct NextUpWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "next-up", provider: SnapshotProvider()) { entry in
            Framed { NextUpView(entry: entry) }
        }
        .configurationDisplayName("Next up")
        .description("Time until your next Work Block, and when to leave.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular])
        .tile()
    }
}

struct NextUpView: View {
    @Environment(\.widgetFamily) private var family
    let entry: SnapshotEntry

    var body: some View {
        if family == .accessoryRectangular {
            InkReader { NextUpRectangle(snapshot: entry.snapshot, now: entry.date) }
        } else {
            SnapshotTile(entry: entry, stale: { snapshot in
                StaleTile(title: "Next up", snapshot: snapshot, figure: "0:00", symbol: "arrow.right", unit: "h:m")
            }) { snapshot, now in
                NextUpTile(snapshot: snapshot, now: now, medium: family == .systemMedium)
            }
        }
    }
}

struct FocusWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "focus", provider: SnapshotProvider()) { entry in
            Framed {
                SnapshotTile(entry: entry) { snapshot, now in FocusTile(snapshot: snapshot, now: now) }
            }
            .widgetURL(Links.focus)
        }
        .configurationDisplayName("Focus")
        .description("Minutes left in your Focus Session.")
        .supportedFamilies([.systemSmall])
        .tile()
    }
}

struct UpcomingWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "upcoming", provider: SnapshotProvider()) { entry in
            Framed {
                SnapshotTile(entry: entry) { snapshot, _ in UpcomingTile(snapshot: snapshot) }
            }
            .widgetURL(Links.upcoming)
        }
        .configurationDisplayName("Upcoming")
        .description("Days to your next Deadline, over the week.")
        .supportedFamilies([.systemMedium])
        .tile()
    }
}

struct BrainDumpWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "brain-dump", provider: SnapshotProvider()) { entry in
            Framed { InkReader { BrainDumpCircle(snapshot: entry.snapshot) } }.widgetURL(Links.capture)
        }
        .configurationDisplayName("Brain Dump")
        .description("Add a thought from the Lock Screen.")
        .supportedFamilies([.accessoryCircular])
    }
}
