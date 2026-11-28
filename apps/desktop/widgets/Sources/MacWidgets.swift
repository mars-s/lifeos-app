import SwiftUI
import WidgetKit

@main
struct LifeOSMacWidgets: WidgetBundle {
    var body: some Widget {
        TodayWidget()
        CapacityWidget()
        NextUpWidget()
        FocusWidget()
        UpcomingWidget()
        WeekWidget()
    }
}

struct Framed<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) { self.content = content() }

    var body: some View {
        content.padding(14).containerBackground(for: .widget) { TileBackground() }
    }
}

struct TodayWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "today", provider: SnapshotProvider()) { entry in
            Framed { TodayView(entry: entry) }.widgetURL(Links.today)
        }
        .configurationDisplayName("Today")
        .description("Tasks left today. Tick one without opening LifeOS.")
        .supportedFamilies([.systemMedium, .systemLarge])
        .contentMarginsDisabled()
    }
}

struct TodayView: View {
    @Environment(\.widgetFamily) private var family
    let entry: SnapshotEntry

    var body: some View {
        SnapshotTile(entry: entry, stale: { snapshot in
            StaleTile(title: "Today", snapshot: snapshot, figure: String(snapshot.tasksLeftNow), symbol: "checkmark.circle.fill", unit: "left")
        }) { snapshot, now in
            TodayTile(snapshot: snapshot, now: now, large: family == .systemLarge)
        }
    }
}

struct CapacityWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "capacity", provider: SnapshotProvider()) { entry in
            Framed {
                SnapshotTile(entry: entry, stale: { snapshot in
                    StaleTile(
                        title: "Capacity", snapshot: snapshot, figure: Format.minutes(max(0, snapshot.capacityMinutes - snapshot.plannedMinutes)),
                        symbol: "hourglass", unit: "h:m")
                }) { snapshot, now in CapacityTile(snapshot: snapshot, now: now) }
            }
            .widgetURL(Links.today)
        }
        .configurationDisplayName("Capacity")
        .description("Free time still ahead of you today, over the day.")
        .supportedFamilies([.systemSmall])
        .contentMarginsDisabled()
    }
}

struct NextUpWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "next-up", provider: SnapshotProvider()) { entry in
            Framed { NextUpView(entry: entry) }
        }
        .configurationDisplayName("Next up")
        .description("Time until your next Work Block, and when to leave.")
        .supportedFamilies([.systemSmall, .systemMedium])
        .contentMarginsDisabled()
    }
}

struct NextUpView: View {
    @Environment(\.widgetFamily) private var family
    let entry: SnapshotEntry

    var body: some View {
        SnapshotTile(entry: entry) { snapshot, now in
            NextUpTile(snapshot: snapshot, now: now, medium: family == .systemMedium)
        }
    }
}

struct FocusWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "focus", provider: SnapshotProvider()) { entry in
            Framed { SnapshotTile(entry: entry) { snapshot, now in FocusTile(snapshot: snapshot, now: now) } }.widgetURL(Links.focus)
        }
        .configurationDisplayName("Focus")
        .description("Minutes left in your Focus Session.")
        .supportedFamilies([.systemSmall])
        .contentMarginsDisabled()
    }
}

struct UpcomingWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "upcoming", provider: SnapshotProvider()) { entry in
            Framed { SnapshotTile(entry: entry) { snapshot, _ in UpcomingTile(snapshot: snapshot) } }.widgetURL(Links.upcoming)
        }
        .configurationDisplayName("Upcoming")
        .description("Days to your next Deadline, over the week.")
        .supportedFamilies([.systemMedium])
        .contentMarginsDisabled()
    }
}

struct WeekWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "this-week", provider: SnapshotProvider()) { entry in
            Framed { SnapshotTile(entry: entry) { snapshot, now in WeekTile(snapshot: snapshot, now: now) } }.widgetURL(Links.upcoming)
        }
        .configurationDisplayName("This week")
        .description("Hours still free this week, Deadlines, Today and the Brain Dump.")
        .supportedFamilies([.systemExtraLarge])
        .contentMarginsDisabled()
    }
}
