import SwiftUI
import WidgetKit

extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: opacity
        )
    }
}

public enum InkMode: Sendable, Equatable {
    case colour(dark: Bool)
    case single
    case standby
}

public struct Ink: Sendable {
    public let mode: InkMode
    public let ink: Color
    public let dim: Color
    public let faint: Color
    public let track: Color
    public let alert: Color
    public let deadline: Color
    public let onInk: Color
    public let tile: Color

    public static func of(mode: InkMode) -> Ink {
        switch mode {
        case .colour(let dark):
            return dark
                ? Ink(
                    mode: mode, ink: Color(hex: 0xE6E8EB), dim: Color(hex: 0x999B9F), faint: Color(hex: 0x616367),
                    track: Color(hex: 0xE6E8EB, opacity: 0.12), alert: Color(hex: 0xFD736D), deadline: Color(hex: 0xF0BA59),
                    onInk: Color(hex: 0x0C0D0F), tile: Color(hex: 0x18191C))
                : Ink(
                    mode: mode, ink: Color(hex: 0x282521), dim: Color(hex: 0x67635D), faint: Color(hex: 0x96918C),
                    track: Color(hex: 0x282521, opacity: 0.12), alert: Color(hex: 0xC9302D), deadline: Color(hex: 0xB0660C),
                    onInk: Color(hex: 0xFEFCF9), tile: Color(hex: 0xFEFCF9))
        case .single, .standby:
            return Ink(
                mode: mode, ink: .white, dim: .white.opacity(0.68), faint: .white.opacity(0.44), track: .white.opacity(0.17),
                alert: .white, deadline: .white, onInk: .black, tile: .clear)
        }
    }

    public var isColour: Bool {
        if case .colour = mode { return true }
        return false
    }

    private static let light: [String: UInt32] = [
        "violet": 0x8362CD, "green": 0x2C965D, "orange": 0xD97230, "teal": 0x0D9298,
        "rose": 0xD7506E, "olive": 0x848E2D, "plum": 0xA84D97, "slate": 0x657383,
    ]

    private static let dark: [String: UInt32] = [
        "violet": 0xB199F4, "green": 0x68CD8F, "orange": 0xF7A062, "teal": 0x5AC8CD,
        "rose": 0xF78C9E, "olive": 0xB5C062, "plum": 0xD98DC9, "slate": 0x97A7B7,
    ]

    public func area(_ colour: String?) -> Color {
        guard case .colour(let isDark) = mode, let colour, let hex = (isDark ? Self.dark : Self.light)[colour] else { return ink }
        return Color(hex: hex)
    }

    public func slice(_ colour: String?) -> Color {
        guard isColour else { return ink }
        return colour == nil ? faint : area(colour)
    }
}

private struct InkKey: EnvironmentKey {
    static let defaultValue = Ink.of(mode: .colour(dark: false))
}

public extension EnvironmentValues {
    var ink: Ink {
        get { self[InkKey.self] }
        set { self[InkKey.self] = newValue }
    }
}

public struct InkReader<Content: View>: View {
    @Environment(\.widgetRenderingMode) private var rendering
    @Environment(\.colorScheme) private var scheme
    @Environment(\.showsWidgetContainerBackground) private var container
    private let content: Content

    public init(@ViewBuilder content: () -> Content) { self.content = content() }

    public var body: some View {
        let mode: InkMode =
            rendering == .fullColor
            ? (container ? .colour(dark: scheme == .dark) : .standby)
            : .single
        let ink = Ink.of(mode: mode)
        content
            .environment(\.ink, ink)
            .foregroundStyle(ink.ink)
    }
}

public enum Typeface {
    public static func text(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        switch weight {
        case .medium: return .custom("Inter-Medium", size: size)
        case .semibold, .bold: return .custom("Inter-SemiBold", size: size)
        default: return .custom("Inter-Regular", size: size)
        }
    }

    public static func mono(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        weight == .regular ? .custom("GeistMono-Regular", size: size) : .custom("GeistMono-Medium", size: size)
    }

    public static func dots(_ pitch: CGFloat) -> Font { .custom("LifeOSDots-Regular", size: pitch * 10) }
}
