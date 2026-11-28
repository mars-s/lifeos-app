import AppIntents
import SwiftUI
import WidgetKit

public enum Links {
    public static let today = URL(string: "lifeos:///")!
    public static let upcoming = URL(string: "lifeos:///upcoming")!
    public static let focus = URL(string: "lifeos:///focus")!
    public static let capture = URL(string: "lifeos:///capture")!

    public static func task(_ id: String) -> URL { URL(string: "lifeos:///task/\(id)")! }
}

struct TaskRow: View {
    @Environment(\.ink) private var ink
    let task: WidgetSnapshot.Task
    let done: Bool
    let height: CGFloat

    var body: some View {
        HStack(spacing: 10) {
            Button(intent: TickTaskIntent(taskId: task.id)) {
                TickMark(done: done)
            }
            .buttonStyle(.plain)
            .padding(-6)
            .accessibilityLabel(done ? "\(task.title), done" : "Complete \(task.title)")
            Text(task.title)
                .font(Typeface.text(13))
                .strikethrough(done, color: ink.faint)
                .foregroundStyle(done ? ink.faint : ink.ink)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
            if let estimate = task.estimateMinutes {
                Text(Format.minutes(estimate)).font(Typeface.mono(11)).foregroundStyle(ink.dim)
            }
            AreaMark(task.area?.colour)
        }
        .frame(height: height)
    }
}

public struct CapacityTile: View {
    @Environment(\.ink) private var ink
    let snapshot: WidgetSnapshot
    let now: Date

    public init(snapshot: WidgetSnapshot, now: Date) {
        self.snapshot = snapshot
        self.now = now
    }

    public var body: some View {
        let left = snapshot.capacityLeft(at: now)
        let state = snapshot.capacityState(at: now)
        let hours = snapshot.workingHours
        let shown = Format.minutes(abs(left))
        VStack(alignment: .leading, spacing: 0) {
            Heading("Capacity", state: state.rawValue)
            Spacer(minLength: 0)
            Figure(shown, label: "\(shown) \(left < 0 ? "over" : "left")", symbol: "hourglass", unit: "h:m")
                .foregroundStyle(left < 0 ? ink.alert : ink.ink)
            VStack(spacing: 0) {
                DayStrip(start: hours.startMinute, end: hours.endMinute, now: snapshot.clock.minute(of: now), spans: snapshot.spans())
                Axis(left < 0 ? "of \(Format.minutes(snapshot.capacityAhead(at: now))) free" : Format.clock(hours.startMinute), Format.clock(hours.endMinute))
            }
            .padding(.top, 14)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Capacity: \(shown) \(left < 0 ? "over" : "left")")
    }
}

struct CapacityFoot: View {
    let snapshot: WidgetSnapshot
    let now: Date
    let dot: CGFloat

    var body: some View {
        let ahead = snapshot.capacityAhead(at: now)
        VStack(spacing: 0) {
            CapacityDots(slices: snapshot.todaySlices, capacity: ahead, dot: dot)
            Axis("\(Format.minutes(max(0, snapshot.capacityLeft(at: now)))) left", "of \(Format.minutes(ahead)) free")
        }
    }
}

public struct TodayTile: View {
    let snapshot: WidgetSnapshot
    let now: Date
    let large: Bool

    public init(snapshot: WidgetSnapshot, now: Date, large: Bool) {
        self.snapshot = snapshot
        self.now = now
        self.large = large
    }

    public var body: some View {
        let left = snapshot.tasksLeftNow
        let count = String(left)
        let dateLabel = snapshot.clock.format(iso: snapshot.date, "EEE d MMM")
        let ticked = snapshot.tickedIds
        if large {
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .top, spacing: 12) {
                    Heading("Today", state: left == 0 ? "clear" : dateLabel)
                    HStack(spacing: 8) {
                        DotNumber(count, label: "\(count) left")
                        UnitBadge("checkmark.circle.fill", unit: "left")
                    }
                }
                VStack(spacing: 0) {
                    ForEach(snapshot.tasks.prefix(6)) { task in
                        TaskRow(task: task, done: ticked.contains(task.id), height: 34)
                    }
                }
                .padding(.top, 12)
                Spacer(minLength: 0)
                DayStrip(
                    start: snapshot.workingHours.startMinute, end: snapshot.workingHours.endMinute, now: snapshot.clock.minute(of: now),
                    spans: snapshot.spans())
                Axis(Format.clock(snapshot.workingHours.startMinute), Format.clock(snapshot.workingHours.endMinute))
                CapacityFoot(snapshot: snapshot, now: now, dot: 5).padding(.top, 12)
            }
        } else {
            VStack(spacing: 0) {
                HStack(alignment: .top, spacing: 16) {
                    VStack(alignment: .leading, spacing: 0) {
                        Heading("Today", state: left == 0 ? "clear" : dateLabel)
                        Spacer(minLength: 0)
                        Figure(count, label: "\(count) left", symbol: "checkmark.circle.fill", unit: "left")
                    }
                    .frame(width: 76)
                    VStack(spacing: 0) {
                        ForEach(snapshot.tasks.prefix(3)) { task in
                            TaskRow(task: task, done: ticked.contains(task.id), height: 32)
                        }
                        Spacer(minLength: 0)
                    }
                }
                CapacityFoot(snapshot: snapshot, now: now, dot: 4.4).padding(.top, 10)
            }
        }
    }
}

public struct NextUpTile: View {
    @Environment(\.ink) private var ink
    let snapshot: WidgetSnapshot
    let now: Date
    let medium: Bool

    public init(snapshot: WidgetSnapshot, now: Date, medium: Bool) {
        self.snapshot = snapshot
        self.now = now
        self.medium = medium
    }

    public var body: some View {
        let clock = snapshot.clock
        let minuteNow = clock.minute(of: now)
        if let block = snapshot.nextBlock(after: now) {
            let start = clock.minute(ofMs: block.start)
            let until = (block.start - now.timeIntervalSince1970 * 1000) / 60_000
            let countdown = Format.minutes(until.rounded(.up))
            let windowStart = (minuteNow / 15).rounded(.down) * 15
            let windowEnd = max(windowStart + 150, start + block.minutes)
            let leave = snapshot.leaveMs(for: block).map { clock.minute(ofMs: $0) }
            if medium {
                VStack(spacing: 0) {
                    HStack(alignment: .top, spacing: 16) {
                        VStack(alignment: .leading, spacing: 0) {
                            Heading("Next up", state: "starts \(Format.clock(start))")
                            Spacer(minLength: 0)
                            Figure(countdown, label: "in \(countdown)", symbol: "arrow.right", unit: "h:m")
                        }
                        .frame(width: 132)
                        VStack(alignment: .leading, spacing: 0) {
                            HStack(spacing: 6) {
                                AreaMark(block.area?.colour)
                                Text(block.area?.name ?? "No Area").font(Typeface.text(11)).foregroundStyle(ink.dim).lineLimit(1)
                            }
                            Text(block.title).font(Typeface.text(15, .medium)).tracking(-0.15).lineLimit(2).padding(.top, 2)
                            if let trip = block.trip {
                                HStack(spacing: 4) {
                                    Image(systemName: "mappin").font(.system(size: 10, weight: .semibold))
                                    Text("\(trip.place), \(Int(trip.minutes)) min drive").font(Typeface.text(11)).lineLimit(1)
                                }
                                .foregroundStyle(ink.dim)
                                .padding(.top, 6)
                            }
                            if let leave {
                                Text("Leave by \(Format.clockWithMinutes(leave))").font(Typeface.text(11))
                            }
                            Spacer(minLength: 0)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    VStack(spacing: 0) {
                        DayStrip(start: windowStart, end: windowEnd, now: minuteNow, spans: snapshot.spans(), step: 15)
                        Axis(Format.clock(windowStart), Format.clock(windowEnd))
                    }
                    .padding(.top, 10)
                }
                .widgetURL(Links.task(block.taskId))
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    Heading("Next up", state: block.title)
                    Spacer(minLength: 0)
                    Figure(countdown, label: "in \(countdown)", symbol: "arrow.right", unit: "h:m")
                    VStack(spacing: 0) {
                        DayStrip(start: windowStart, end: windowEnd, now: minuteNow, spans: snapshot.spans(), step: 15)
                        Axis(leave.map { "leave \(Format.clock($0))" } ?? Format.clock(windowStart), block.trip?.place ?? Format.clock(windowEnd))
                    }
                    .padding(.top, 14)
                }
                .widgetURL(Links.task(block.taskId))
            }
        } else {
            VStack(alignment: .leading, spacing: 0) {
                Heading("Next up", state: "nothing booked")
                Spacer(minLength: 0)
                Text("Free until tomorrow, \(Format.clock(snapshot.workingHours.startMinute))").font(Typeface.text(13)).foregroundStyle(ink.dim)
                VStack(spacing: 0) {
                    DayStrip(start: snapshot.workingHours.startMinute, end: snapshot.workingHours.endMinute, now: minuteNow, spans: snapshot.spans())
                    Axis(Format.clock(snapshot.workingHours.startMinute), Format.clock(snapshot.workingHours.endMinute))
                }
                .padding(.top, 14)
            }
        }
    }
}

public struct FocusTile: View {
    @Environment(\.ink) private var ink
    let snapshot: WidgetSnapshot
    let now: Date

    public init(snapshot: WidgetSnapshot, now: Date) {
        self.snapshot = snapshot
        self.now = now
    }

    public var body: some View {
        if let focus = snapshot.focus {
            let planned = Int(focus.plannedMinutes ?? 25)
            let elapsed = Int(focus.elapsedMs(at: now) / 60_000)
            let shown = focus.countsDown ? Int((focus.remainingMs(at: now) / 60_000).rounded(.up)) : elapsed
            VStack(alignment: .leading, spacing: 0) {
                Heading("Focus", state: focus.isPaused ? "paused" : (focus.kind == "break" ? "break" : focus.title))
                Spacer(minLength: 0)
                Figure(String(shown), label: "\(shown) minutes \(focus.countsDown ? "left" : "in")", symbol: "timer", unit: "min")
                    .foregroundStyle(focus.isPaused ? ink.dim : ink.ink)
                VStack(spacing: 0) {
                    FocusStrip(total: planned, elapsed: elapsed)
                    Axis(focus.round.map { "round \(Int($0))" } ?? "0", Format.countdown(Double(planned) * 60_000))
                }
                .padding(.top, 14)
            }
        } else {
            let task = snapshot.nextBlock(after: now).map(\.title) ?? snapshot.openTasks.first?.title
            VStack(alignment: .leading, spacing: 0) {
                Heading("Focus", state: "ready")
                Spacer(minLength: 0)
                Text(task ?? "Nothing on Today").font(Typeface.text(13)).foregroundStyle(ink.dim).lineLimit(2)
                HStack(spacing: 6) {
                    Image(systemName: "play.fill").font(.system(size: 10))
                    Text("Start").font(Typeface.text(13, .medium))
                }
                .foregroundStyle(ink.onInk)
                .frame(maxWidth: .infinity, minHeight: 32)
                .background(ink.ink, in: Capsule())
                .padding(.top, 8)
            }
        }
    }
}

public struct UpcomingTile: View {
    @Environment(\.ink) private var ink
    let snapshot: WidgetSnapshot

    public init(snapshot: WidgetSnapshot) { self.snapshot = snapshot }

    public var body: some View {
        let next = snapshot.deadlines.first
        let days = next.map { snapshot.daysUntil($0) }
        HStack(spacing: 20) {
            VStack(alignment: .leading, spacing: 0) {
                Heading("Upcoming", state: next.map { "due \(snapshot.clock.format(iso: $0.date, days.map { $0 < 7 } == true ? "EEE" : "d MMM"))" } ?? "no Deadlines")
                Spacer(minLength: 0)
                Figure(days.map(String.init) ?? "0", label: "\(days ?? 0) days to the next Deadline", symbol: "flag.fill", unit: "days")
                Text(next?.title ?? "Nothing due for four weeks").font(Typeface.text(10)).foregroundStyle(ink.dim).lineLimit(1).padding(.top, 14)
            }
            .frame(width: 84)
            WeekColumns(snapshot: snapshot).frame(maxWidth: .infinity)
        }
    }
}

public struct WeekTile: View {
    @Environment(\.ink) private var ink
    let snapshot: WidgetSnapshot
    let now: Date

    public init(snapshot: WidgetSnapshot, now: Date) {
        self.snapshot = snapshot
        self.now = now
    }

    public var body: some View {
        let free = Format.minutes(snapshot.weekFreeMinutes)
        let clock = snapshot.clock
        let range = "\(clock.format(iso: snapshot.week.first?.date ?? snapshot.date, "d MMM")) to \(clock.format(iso: snapshot.week.last?.date ?? snapshot.date, "d MMM"))"
        let ticked = snapshot.tickedIds
        HStack(spacing: 32) {
            VStack(alignment: .leading, spacing: 0) {
                Heading("This week", state: range)
                HStack(spacing: 10) {
                    DotNumber(free, pitch: 6.5, label: "\(free) still free")
                    UnitBadge("calendar", unit: "free")
                }
                .padding(.top, 16)
                Spacer(minLength: 0)
                WeekColumns(snapshot: snapshot, perRow: 2, dot: 11, gap: 5, detail: true).padding(.trailing, 8)
            }
            VStack(alignment: .leading, spacing: 0) {
                Text("Deadlines").font(Typeface.text(11)).foregroundStyle(ink.dim)
                VStack(spacing: 0) {
                    ForEach(snapshot.deadlines) { deadline in
                        HStack(spacing: 10) {
                            DeadlineMark().padding(.horizontal, 2)
                            Text(deadline.title).font(Typeface.text(13)).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
                            Text("\(clock.format(iso: deadline.date, "EEE")), \(snapshot.daysUntil(deadline)) d").font(Typeface.mono(11)).foregroundStyle(ink.dim)
                            AreaMark(deadline.area?.colour)
                        }
                        .frame(height: 34)
                    }
                }
                .padding(.top, 4)
                Text("Today").font(Typeface.text(11)).foregroundStyle(ink.dim).padding(.top, 16)
                VStack(spacing: 0) {
                    ForEach(snapshot.tasks.prefix(3)) { task in
                        TaskRow(task: task, done: ticked.contains(task.id), height: 34)
                    }
                }
                .padding(.top, 4)
                Spacer(minLength: 0)
                HStack(spacing: 6) {
                    Image(systemName: "tray.fill").font(.system(size: 10))
                    Text("Brain Dump")
                    Spacer(minLength: 0)
                    Text("\(snapshot.brainDump) to sort").font(Typeface.mono(11))
                }
                .font(Typeface.text(11))
                .foregroundStyle(ink.dim)
            }
            .frame(width: 248)
        }
    }
}

public struct PlaceholderTile: View {
    @Environment(\.ink) private var ink

    public init() {}

    public var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Capsule().fill(ink.track).frame(width: 64, height: 12)
            Capsule().fill(ink.track).frame(width: 40, height: 8).padding(.top, 8)
            Spacer(minLength: 0)
            HStack {
                DotNumber("8:88").foregroundStyle(ink.track)
                Spacer(minLength: 0)
                RoundedRectangle(cornerRadius: 8).fill(ink.track).frame(width: 26, height: 28)
            }
            VStack(spacing: 4) {
                DayStrip(start: 9 * 60, end: 17.5 * 60, now: nil, spans: [])
                HStack {
                    Capsule().fill(ink.track).frame(width: 24, height: 8)
                    Spacer(minLength: 0)
                    Capsule().fill(ink.track).frame(width: 32, height: 8)
                }
            }
            .padding(.top, 14)
        }
        .accessibilityLabel("LifeOS, waiting for its first snapshot")
    }
}

public struct StaleTile: View {
    @Environment(\.ink) private var ink
    let title: String
    let snapshot: WidgetSnapshot
    let figure: String
    let symbol: String
    let unit: String

    public init(title: String, snapshot: WidgetSnapshot, figure: String, symbol: String, unit: String) {
        self.title = title
        self.snapshot = snapshot
        self.figure = figure
        self.symbol = symbol
        self.unit = unit
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Heading(title, state: "as of \(snapshot.clock.format(iso: snapshot.date, "EEE"))")
            Spacer(minLength: 0)
            Figure(figure, label: "\(figure) as of \(snapshot.clock.format(iso: snapshot.date, "EEEE"))", symbol: symbol, unit: unit)
                .foregroundStyle(ink.faint)
            Text("Open LifeOS to refresh").font(Typeface.text(11)).foregroundStyle(ink.dim).padding(.top, 14)
        }
    }
}
