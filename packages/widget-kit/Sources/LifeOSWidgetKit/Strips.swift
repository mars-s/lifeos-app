import SwiftUI
import WidgetKit

public struct DayStrip: View {
    @Environment(\.ink) private var ink
    let start: Double
    let end: Double
    let now: Double?
    let spans: [Span]
    let step: Double

    public init(start: Double, end: Double, now: Double?, spans: [Span], step: Double = 30) {
        self.start = start
        self.end = end
        self.now = now
        self.spans = spans
        self.step = step
    }

    public var body: some View {
        GeometryReader { geometry in
            let width = geometry.size.width
            let length = max(1, end - start)
            let x = { (minute: Double) in CGFloat((minute - start) / length) * width }
            let shown = spans.compactMap { span -> Span? in
                guard span.end > start, span.start < end else { return nil }
                var clipped = span
                clipped.start = max(start, span.start)
                clipped.end = min(end, span.end)
                return clipped
            }
            let first = (start / step).rounded(.up) * step
            let ticks = stride(from: first, through: end, by: step).filter { minute in
                !shown.contains { minute >= $0.start && minute <= $0.end }
            }
            ZStack(alignment: .bottomLeading) {
                ForEach(ticks, id: \.self) { minute in
                    Capsule()
                        .fill(ink.faint)
                        .frame(width: 1, height: minute.truncatingRemainder(dividingBy: 60) == 0 ? 8 : 5)
                        .opacity(now.map { minute < $0 ? 0.45 : 1 } ?? 1)
                        .offset(x: x(minute) - 0.5)
                }
                ForEach(shown) { span in
                    spanView(span)
                        .frame(width: max(1.5, x(span.end) - x(span.start)), height: span.kind == .trip ? 2 : 6)
                        .opacity(now.map { span.end <= $0 ? 0.4 : 1 } ?? 1)
                        .offset(x: x(span.start), y: span.kind == .trip ? -2 : 0)
                }
                if let now, now >= start, now <= end {
                    Capsule().fill(ink.ink).frame(width: 1.5, height: 14).offset(x: x(now) - 0.75).widgetAccentable()
                }
            }
            .frame(width: width, height: 12, alignment: .bottomLeading)
        }
        .frame(height: 12)
        .accessibilityHidden(true)
    }

    @ViewBuilder
    private func spanView(_ span: Span) -> some View {
        switch span.kind {
        case .block:
            RoundedRectangle(cornerRadius: 2).fill(ink.area(span.colour)).widgetAccentable()
        case .commitment:
            RoundedRectangle(cornerRadius: 2).strokeBorder(ink.dim, lineWidth: 1)
        case .trip:
            DashedLine().stroke(ink.dim, style: StrokeStyle(lineWidth: 2, dash: [2, 2]))
        }
    }
}

struct DashedLine: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.midY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.midY))
        return path
    }
}

public struct CapacityDots: View {
    @Environment(\.ink) private var ink
    let slices: [WidgetSnapshot.Slice]
    let capacity: Double
    let dot: CGFloat
    let maxDots: Int

    public init(slices: [WidgetSnapshot.Slice], capacity: Double, dot: CGFloat = 5, maxDots: Int = 44) {
        self.slices = slices
        self.capacity = capacity
        self.dot = dot
        self.maxDots = maxDots
    }

    private struct Cell: Identifiable {
        let id: Int
        let colour: String??
        let over: Bool
    }

    public var body: some View {
        let filled: [String?] = slices.flatMap { slice in Array(repeating: slice.colour, count: Int((slice.minutes / 15).rounded())) }
        let free = Int((capacity / 15).rounded())
        let count = min(maxDots, max(free, filled.count))
        let cells = (0..<count).map { index in
            Cell(id: index, colour: index < filled.count ? .some(filled[index]) : .none, over: index >= free)
        }
        let hours = stride(from: 0, to: cells.count, by: 4).map { Array(cells[$0..<min($0 + 4, cells.count)]) }
        HStack(spacing: dot * 1.2) {
            ForEach(Array(hours.enumerated()), id: \.offset) { _, hour in
                HStack(spacing: dot * 0.5) {
                    ForEach(hour) { cell in
                        if cell.over {
                            Circle().strokeBorder(ink.alert, lineWidth: 1.25).frame(width: dot, height: dot)
                        } else if let colour = cell.colour {
                            Circle().fill(ink.slice(colour)).frame(width: dot, height: dot).widgetAccentable()
                        } else {
                            Circle().fill(ink.track).frame(width: dot, height: dot)
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel("\(Format.minutes(slices.reduce(0) { $0 + $1.minutes })) planned of \(Format.minutes(capacity)) free")
    }
}

public struct WeekColumns: View {
    @Environment(\.ink) private var ink
    let snapshot: WidgetSnapshot
    let perRow: Int
    let dot: CGFloat
    let gap: CGFloat
    let detail: Bool

    public init(snapshot: WidgetSnapshot, perRow: Int = 1, dot: CGFloat = 6, gap: CGFloat = 3, detail: Bool = false) {
        self.snapshot = snapshot
        self.perRow = perRow
        self.dot = dot
        self.gap = gap
        self.detail = detail
    }

    public var body: some View {
        let unit = 60 / Double(perRow)
        HStack(alignment: .bottom, spacing: 0) {
            ForEach(Array(snapshot.week.enumerated()), id: \.element.id) { index, day in
                if index > 0 { Spacer(minLength: 0) }
                column(day, unit: unit, today: index == 0)
            }
        }
    }

    private func column(_ day: WidgetSnapshot.Day, unit: Double, today: Bool) -> some View {
        let filled: [String?] = day.slices.flatMap { Array(repeating: $0.colour, count: Int(($0.minutes / unit).rounded())) }
        let count = min(14 * perRow, max(filled.count, Int((day.capacityMinutes / unit).rounded())))
        let rows = stride(from: 0, to: count, by: perRow).map { start in (start..<min(start + perRow, count)).map { $0 } }
        let width = CGFloat(perRow) * dot + CGFloat(perRow - 1) * gap
        let clock = snapshot.clock
        return VStack(spacing: 0) {
            ZStack {
                if day.deadlines > 0 { DeadlineMark() }
            }
            .frame(height: 12)
            VStack(spacing: gap) {
                if count == 0 {
                    Capsule().fill(ink.track).frame(width: width, height: 1.5)
                }
                ForEach(Array(rows.reversed().enumerated()), id: \.offset) { _, row in
                    HStack(spacing: gap) {
                        ForEach(row, id: \.self) { index in
                            if index < filled.count {
                                Circle().fill(ink.slice(filled[index])).frame(width: dot, height: dot).widgetAccentable()
                            } else {
                                Circle().fill(ink.track).frame(width: dot, height: dot)
                            }
                        }
                    }
                    .frame(width: width, alignment: .leading)
                }
            }
            if detail {
                VStack(spacing: 0) {
                    Text(clock.format(iso: day.date, "EEE"))
                        .font(Typeface.text(11, today ? .medium : .regular))
                        .foregroundStyle(today ? ink.ink : ink.dim)
                    Text(day.plannedMinutes > 0 ? Format.minutes(day.plannedMinutes) : "free").font(Typeface.mono(10)).foregroundStyle(ink.dim)
                }
                .padding(.top, 8)
            } else {
                Text(String(clock.format(iso: day.date, "EEEEE").prefix(1)))
                    .font(Typeface.mono(10, today ? .medium : .regular))
                    .foregroundStyle(today ? ink.ink : ink.dim)
                    .padding(.top, 6)
            }
        }
        .accessibilityElement()
        .accessibilityLabel(
            "\(clock.format(iso: day.date, "EEEE d")), \(Format.minutes(day.plannedMinutes)) planned of \(Format.minutes(day.capacityMinutes)) free\(day.deadlines > 0 ? ", a Deadline" : "")"
        )
    }
}

public struct FocusStrip: View {
    @Environment(\.ink) private var ink
    let total: Int
    let elapsed: Int

    public init(total: Int, elapsed: Int) {
        self.total = max(1, min(total, 90))
        self.elapsed = min(elapsed, self.total)
    }

    public var body: some View {
        HStack(alignment: .bottom, spacing: 0) {
            ForEach(0..<total, id: \.self) { index in
                if index > 0 { Spacer(minLength: 0) }
                Capsule()
                    .fill(index < elapsed ? ink.ink : ink.faint)
                    .frame(width: 2, height: index < elapsed || index % 5 == 0 ? 10 : 6)
                    .opacity(index < elapsed ? 1 : 0.7)
            }
        }
        .frame(height: 10)
        .widgetAccentable()
        .accessibilityElement()
        .accessibilityLabel("\(elapsed) of \(total) minutes done")
    }
}

public struct DotRing: View {
    @Environment(\.ink) private var ink
    let total: Int
    let filled: Int
    let dot: CGFloat

    public init(total: Int, filled: Int, dot: CGFloat = 2) {
        self.total = total
        self.filled = filled
        self.dot = dot
    }

    public var body: some View {
        GeometryReader { geometry in
            let size = min(geometry.size.width, geometry.size.height)
            let reach = size / 2 - dot - 2
            ZStack {
                ForEach(0..<total, id: \.self) { index in
                    let angle = Double(index) / Double(total) * .pi * 2 - .pi / 2
                    Circle()
                        .fill(index < filled ? ink.ink : ink.track)
                        .frame(width: dot * 2, height: dot * 2)
                        .position(x: size / 2 + CGFloat(cos(angle)) * reach, y: size / 2 + CGFloat(sin(angle)) * reach)
                }
            }
            .frame(width: size, height: size)
        }
        .accessibilityHidden(true)
    }
}
