import ActivityKit
import ExpoModulesCore
import WidgetKit

public class LifeOSWidgetsModule: Module {
    public func definition() -> ModuleDefinition {
        Name("LifeOSWidgets")

        Function("writeSnapshot") { (json: String) throws in
            try WidgetStore.writeRaw(Data(json.utf8))
            Self.reload()
        }

        Function("setToken") { (token: String?) -> Bool in
            SharedToken.write(token)
        }

        Function("pendingTicks") { () -> [String] in
            WidgetStore.pendingTicks().map(\.taskId)
        }

        Function("clearTicks") { (taskIds: [String]) in
            WidgetStore.clear(taskIds)
            Self.reload()
        }

        Function("takeRoute") { () -> String? in
            let defaults = UserDefaults(suiteName: WidgetStore.appGroup)
            let route = defaults?.string(forKey: "route")
            defaults?.removeObject(forKey: "route")
            return route
        }

        AsyncFunction("syncFocus") { (json: String?) async in
            let focus = json.flatMap { try? JSONDecoder().decode(WidgetSnapshot.Focus.self, from: Data($0.utf8)) }
            await FocusActivities.sync(focus)
        }
    }

    static func reload() {
        WidgetCenter.shared.reloadAllTimelines()
        if #available(iOS 18.0, *) {
            ControlCenter.shared.reloadAllControls()
        }
    }
}

enum FocusActivities {
    static func sync(_ focus: WidgetSnapshot.Focus?) async {
        let running = Activity<FocusActivityAttributes>.activities
        guard let focus else {
            for activity in running { await activity.end(nil, dismissalPolicy: .immediate) }
            return
        }
        let state = FocusActivityAttributes.ContentState(
            start: focus.effectiveStart,
            end: focus.endDate,
            pausedAt: focus.pausedAt.map { Date(timeIntervalSince1970: $0 / 1000) },
            plannedMinutes: focus.plannedMinutes,
            round: focus.round.map { Int($0) },
            kind: focus.kind
        )
        let content = ActivityContent(state: state, staleDate: focus.endDate?.addingTimeInterval(5 * 60))
        let same = running.first { $0.attributes.taskId == focus.taskId }
        for activity in running where activity.id != same?.id {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
        if let same {
            if same.content.state != state { await same.update(content) }
            return
        }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        let attributes = FocusActivityAttributes(taskId: focus.taskId, title: focus.title, areaName: nil, colour: focus.colour)
        _ = try? Activity.request(attributes: attributes, content: content, pushType: nil)
    }
}
