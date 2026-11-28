import ActivityKit
import SwiftUI
import WidgetKit

struct FocusLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: FocusActivityAttributes.self) { context in
            FocusBanner(attributes: context.attributes, state: context.state)
                .environment(\.ink, Ink.of(mode: .single))
                .foregroundStyle(.white)
                .padding(16)
                .activityBackgroundTint(Color(hex: 0x161618, opacity: 0.72))
                .activitySystemActionForegroundColor(.white)
                .widgetURL(Links.focus)
        } dynamicIsland: { context in
            let state = context.state
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    FocusTitle(attributes: context.attributes, state: state).padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    FocusClock(state: state, pitch: 3.6).padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    FocusControls(state: state).padding(.horizontal, 4)
                }
            } compactLeading: {
                FocusDial(state: state).frame(width: 22, height: 22)
            } compactTrailing: {
                FocusCountdown(state: state).font(Typeface.mono(14, .medium)).frame(maxWidth: 52)
            } minimal: {
                FocusDial(state: state).frame(width: 24, height: 24)
            }
            .widgetURL(Links.focus)
            .keylineTint(.white)
        }
    }
}

struct FocusBanner: View {
    let attributes: FocusActivityAttributes
    let state: FocusActivityAttributes.ContentState

    var body: some View {
        VStack(spacing: 12) {
            HStack(alignment: .center, spacing: 12) {
                FocusTitle(attributes: attributes, state: state)
                FocusClock(state: state, pitch: 4.4)
            }
            FocusControls(state: state)
        }
    }
}

struct FocusTitle: View {
    @Environment(\.ink) private var ink
    let attributes: FocusActivityAttributes
    let state: FocusActivityAttributes.ContentState

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            HStack(spacing: 6) {
                Circle().fill(Ink.of(mode: .colour(dark: true)).area(attributes.colour)).frame(width: 6, height: 6)
                Text(state.kind == "break" ? "Break" : (state.pausedAt == nil ? "Focus" : "Paused")).font(Typeface.text(11)).foregroundStyle(ink.dim)
            }
            Text(attributes.title).font(Typeface.text(15, .semibold)).lineLimit(1)
            if let round = state.round {
                Text("Pomodoro \(round)").font(Typeface.text(11)).foregroundStyle(ink.dim)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct FocusCountdown: View {
    let state: FocusActivityAttributes.ContentState

    var body: some View {
        if let pausedAt = state.pausedAt {
            let elapsed = pausedAt.timeIntervalSince(state.start)
            let shown = state.plannedMinutes.map { max(0, $0 * 60 - elapsed) } ?? elapsed
            Text(Format.countdown(shown * 1000)).monospacedDigit()
        } else if let end = state.end {
            Text(timerInterval: state.start...end, countsDown: true).monospacedDigit().multilineTextAlignment(.trailing)
        } else {
            Text(timerInterval: state.start...state.start.addingTimeInterval(86_400), countsDown: false).monospacedDigit()
                .multilineTextAlignment(.trailing)
        }
    }
}

struct FocusClock: View {
    let state: FocusActivityAttributes.ContentState
    let pitch: CGFloat

    var body: some View {
        FocusCountdown(state: state)
            .font(Typeface.dots(pitch))
            .frame(width: pitch * 30, alignment: .trailing)
            .opacity(state.pausedAt == nil ? 1 : 0.6)
    }
}

struct TickMask: View {
    var body: some View {
        HStack(alignment: .bottom, spacing: 0) {
            ForEach(0..<25, id: \.self) { index in
                if index > 0 { Spacer(minLength: 0) }
                Capsule().frame(width: 2, height: index % 5 == 0 ? 10 : 7)
            }
        }
        .frame(height: 10)
    }
}

struct FocusControls: View {
    @Environment(\.ink) private var ink
    let state: FocusActivityAttributes.ContentState

    var body: some View {
        HStack(spacing: 12) {
            VStack(spacing: 0) {
                ZStack {
                    TickMask().foregroundStyle(ink.faint)
                    if let end = state.end {
                        ProgressView(timerInterval: state.start...end, countsDown: false) {
                            EmptyView()
                        } currentValueLabel: {
                            EmptyView()
                        }
                        .progressViewStyle(.linear)
                        .tint(.white)
                        .scaleEffect(x: 1, y: 6, anchor: .center)
                        .mask(TickMask())
                    }
                }
                Axis("0", state.plannedMinutes.map { Format.countdown($0 * 60_000) } ?? "open")
            }
            Link(destination: Links.focus) {
                Image(systemName: state.pausedAt == nil ? "pause.fill" : "play.fill").font(.system(size: 14))
                    .frame(width: 36, height: 36)
                    .background(.white.opacity(0.16), in: Circle())
            }
            .accessibilityLabel(state.pausedAt == nil ? "Pause the Focus Session" : "Resume the Focus Session")
            Link(destination: Links.focus) {
                Image(systemName: "stop.fill").font(.system(size: 14))
                    .frame(width: 36, height: 36)
                    .background(.white.opacity(0.16), in: Circle())
            }
            .accessibilityLabel("Stop the Focus Session")
        }
    }
}

struct FocusDial: View {
    let state: FocusActivityAttributes.ContentState

    var body: some View {
        if let end = state.end {
            ProgressView(timerInterval: state.start...end, countsDown: true) {
                EmptyView()
            } currentValueLabel: {
                Image(systemName: "timer").font(.system(size: 9, weight: .semibold))
            }
            .progressViewStyle(.circular)
            .tint(.white)
        } else {
            Image(systemName: state.pausedAt == nil ? "timer" : "pause.fill").font(.system(size: 12, weight: .semibold))
        }
    }
}
