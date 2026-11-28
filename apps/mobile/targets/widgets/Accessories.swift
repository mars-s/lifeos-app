import SwiftUI
import WidgetKit

struct TodayCircle: View {
    let snapshot: WidgetSnapshot?

    var body: some View {
        let left = snapshot?.tasksLeftNow ?? 0
        DotNumber(String(min(left, 99)), pitch: 4.2, label: "\(left) left")
            .opacity(snapshot == nil ? 0.3 : 1)
    }
}

struct TodayInline: View {
    let snapshot: WidgetSnapshot?
    let now: Date

    var body: some View {
        if let snapshot, !snapshot.isStale(at: now) {
            Label("\(Format.minutes(max(0, snapshot.capacityLeft(at: now)))) free, \(snapshot.tasksLeftNow) left", systemImage: "hourglass")
        } else {
            Label("Open LifeOS", systemImage: "hourglass")
        }
    }
}

struct CapacityCircle: View {
    @Environment(\.ink) private var ink
    let snapshot: WidgetSnapshot?
    let now: Date

    var body: some View {
        let ahead = snapshot?.capacityAhead(at: now) ?? 0
        let left = snapshot?.capacityLeft(at: now) ?? 0
        let planned = max(0, ahead - max(0, left))
        ZStack {
            DotRing(total: 30, filled: ahead > 0 ? Int((planned / ahead * 30).rounded()) : 30, dot: 1.75)
            VStack(spacing: 2) {
                Text(Format.minutes(abs(left))).font(Typeface.mono(15, .medium)).widgetAccentable()
                Text(left < 0 ? "over" : "free").font(Typeface.text(10)).foregroundStyle(ink.dim)
            }
        }
        .accessibilityElement()
        .accessibilityLabel("Capacity: \(Format.minutes(abs(left))) \(left < 0 ? "over" : "free")")
    }
}

struct BrainDumpCircle: View {
    let snapshot: WidgetSnapshot?

    var body: some View {
        VStack(spacing: 4) {
            Image(systemName: "tray.fill").font(.system(size: 18))
            Text("+\(snapshot?.brainDump ?? 0)").font(Typeface.mono(13, .medium))
        }
        .widgetAccentable()
        .accessibilityElement()
        .accessibilityLabel("Brain Dump: \(snapshot?.brainDump ?? 0) to sort. Tap to add")
    }
}

struct NextUpRectangle: View {
    @Environment(\.ink) private var ink
    let snapshot: WidgetSnapshot?
    let now: Date

    var body: some View {
        if let snapshot, let block = snapshot.nextBlock(after: now) {
            let clock = snapshot.clock
            let minuteNow = clock.minute(of: now)
            let start = clock.minute(ofMs: block.start)
            let windowStart = (minuteNow / 15).rounded(.down) * 15
            let windowEnd = max(windowStart + 150, start + 15)
            VStack(alignment: .leading, spacing: 0) {
                Text(block.title).font(Typeface.text(15, .semibold)).lineLimit(1).widgetAccentable()
                Text("\(Format.clockWithMinutes(start))\(block.trip.map { ", \($0.place)" } ?? "")").font(Typeface.text(13)).foregroundStyle(ink.dim)
                    .lineLimit(1)
                DayStrip(start: windowStart, end: windowEnd, now: minuteNow, spans: snapshot.spans(), step: 15).padding(.top, 6)
            }
            .widgetURL(Links.task(block.taskId))
        } else {
            VStack(alignment: .leading, spacing: 2) {
                Text("Next up").font(Typeface.text(15, .semibold))
                Text(snapshot == nil ? "Open LifeOS" : "Nothing booked").font(Typeface.text(13)).foregroundStyle(ink.dim)
            }
        }
    }
}
