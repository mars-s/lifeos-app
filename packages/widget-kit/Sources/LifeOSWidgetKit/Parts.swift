import SwiftUI
import WidgetKit

public struct TileBackground: View {
    @Environment(\.colorScheme) private var scheme

    public init() {}

    public var body: some View {
        Ink.of(mode: .colour(dark: scheme == .dark)).tile
    }
}

struct DotsShape: Shape {
    let value: String
    let pitch: CGFloat

    func path(in rect: CGRect) -> Path {
        let radius = pitch * 0.37
        var path = Path()
        for dot in Glyphs.dots(value).dots {
            let centre = CGPoint(x: CGFloat(dot.x) * pitch + radius, y: CGFloat(dot.y) * pitch + radius)
            path.addEllipse(in: CGRect(x: centre.x - radius, y: centre.y - radius, width: radius * 2, height: radius * 2))
        }
        return path
    }

    static func size(_ value: String, pitch: CGFloat) -> CGSize {
        let columns = Glyphs.dots(value).columns
        let radius = pitch * 0.37
        guard columns > 0 else { return .zero }
        return CGSize(width: CGFloat(columns - 1) * pitch + radius * 2, height: CGFloat(Glyphs.rows - 1) * pitch + radius * 2)
    }
}

public struct DotNumber: View {
    let value: String
    let pitch: CGFloat
    let label: String?

    public init(_ value: String, pitch: CGFloat = 5.5, label: String? = nil) {
        self.value = value
        self.pitch = pitch
        self.label = label
    }

    public var body: some View {
        let size = DotsShape.size(value, pitch: pitch)
        DotsShape(value: value, pitch: pitch)
            .frame(width: size.width, height: size.height)
            .widgetAccentable()
            .accessibilityElement()
            .accessibilityLabel(label ?? value)
    }
}

public struct Heading: View {
    @Environment(\.ink) private var ink
    let title: String
    let state: String

    public init(_ title: String, state: String) {
        self.title = title
        self.state = state
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(title).font(Typeface.text(15, .medium)).tracking(-0.15).lineLimit(1).frame(height: 20, alignment: .leading)
            Text(state).font(Typeface.text(11)).foregroundStyle(ink.dim).lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

public struct UnitBadge: View {
    @Environment(\.ink) private var ink
    let symbol: String
    let unit: String

    public init(_ symbol: String, unit: String) {
        self.symbol = symbol
        self.unit = unit
    }

    public var body: some View {
        VStack(spacing: 1) {
            Image(systemName: symbol).font(.system(size: 10, weight: .semibold)).frame(height: 12)
            Text(unit).font(Typeface.text(10, .medium)).lineLimit(1).minimumScaleFactor(0.8)
        }
        .padding(.top, 4)
        .padding(.bottom, 2)
        .frame(width: 26)
        .background(ink.track, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .accessibilityHidden(true)
    }
}

public struct Figure: View {
    let value: String
    let label: String
    let symbol: String
    let unit: String
    let pitch: CGFloat

    public init(_ value: String, label: String, symbol: String, unit: String, pitch: CGFloat = 5.5) {
        self.value = value
        self.label = label
        self.symbol = symbol
        self.unit = unit
        self.pitch = pitch
    }

    public var body: some View {
        HStack(alignment: .center, spacing: 8) {
            DotNumber(value, pitch: pitch, label: label)
            Spacer(minLength: 0)
            UnitBadge(symbol, unit: unit)
        }
    }
}

public struct Axis: View {
    @Environment(\.ink) private var ink
    let left: String
    let right: String

    public init(_ left: String, _ right: String) {
        self.left = left
        self.right = right
    }

    public var body: some View {
        HStack(spacing: 8) {
            Text(left).lineLimit(1)
            Spacer(minLength: 0)
            Text(right).lineLimit(1)
        }
        .font(Typeface.mono(10))
        .foregroundStyle(ink.dim)
        .padding(.top, 4)
        .accessibilityHidden(true)
    }
}

public struct AreaMark: View {
    @Environment(\.ink) private var ink
    let colour: String?

    public init(_ colour: String?) { self.colour = colour }

    public var body: some View {
        Circle().fill(colour == nil ? ink.faint : ink.area(colour)).frame(width: 6, height: 6).accessibilityHidden(true)
    }
}

public struct DeadlineMark: View {
    @Environment(\.ink) private var ink
    let size: CGFloat

    public init(size: CGFloat = 5) { self.size = size }

    public var body: some View {
        RoundedRectangle(cornerRadius: 1).fill(ink.deadline).frame(width: size, height: size).rotationEffect(.degrees(45))
            .widgetAccentable()
    }
}

public struct TickMark: View {
    @Environment(\.ink) private var ink
    let done: Bool

    public init(done: Bool) { self.done = done }

    public var body: some View {
        ZStack {
            if done {
                RoundedRectangle(cornerRadius: 6, style: .continuous).fill(ink.ink)
                Image(systemName: "checkmark").font(.system(size: 10, weight: .bold)).foregroundStyle(ink.onInk)
            } else {
                RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(ink.faint, lineWidth: 1.5)
            }
        }
        .frame(width: 18, height: 18)
        .frame(width: 32, height: 32)
        .contentShape(Rectangle())
    }
}
