import Foundation

public enum Sample {
    public static func snapshot(on now: Date = .now, timeZone: String = TimeZone.current.identifier) -> WidgetSnapshot {
        let clock = DayClock(timeZone: timeZone)
        let date = clock.isoDate(of: now)
        let base = (clock.moment(iso: date, minute: 0) ?? now).timeIntervalSince1970 * 1000
        let at = { (hour: Double, minute: Double) in base + (hour * 60 + minute) * 60_000 }
        let university = WidgetSnapshot.Area(name: "University", colour: "violet")
        let korvant = WidgetSnapshot.Area(name: "Korvant", colour: "teal")
        let chemwatch = WidgetSnapshot.Area(name: "Chemwatch", colour: "rose")
        let personal = WidgetSnapshot.Area(name: "Personal", colour: "green")
        let paperless = WidgetSnapshot.Area(name: "Paperless", colour: "orange")
        let tasks: [WidgetSnapshot.Task] = [
            .init(id: "methods", title: "Methods draft", area: university, estimateMinutes: 90),
            .init(id: "review", title: "Review onboarding PR", area: korvant, estimateMinutes: 45),
            .init(id: "sds", title: "Fix the SDS import", area: chemwatch, estimateMinutes: 60),
            .init(id: "physio", title: "Book the physio", area: personal, estimateMinutes: 15),
            .init(id: "timesheet", title: "Send the timesheet", area: paperless, estimateMinutes: 15),
            .init(id: "rail", title: "Pick a rail pass", area: personal, estimateMinutes: 30),
        ]
        let next = clock.date(iso: date).map { day in (1...6).map { clock.isoDate(of: day.addingTimeInterval(Double($0) * 86_400)) } } ?? []
        let day = { (index: Int, capacity: Double, slices: [(String, Double)], deadlines: Int) in
            WidgetSnapshot.Day(
                date: next[safe: index - 1] ?? date, capacityMinutes: capacity, plannedMinutes: slices.reduce(0) { $0 + $1.1 },
                slices: slices.map { .init(colour: $0.0, minutes: $0.1) }, deadlines: deadlines)
        }
        return WidgetSnapshot(
            v: 1, writtenAt: now.timeIntervalSince1970 * 1000, convexUrl: nil, date: date, timeZone: timeZone,
            workingHours: .init(startMinute: 540, endMinute: 1050), capacityMinutes: 450, plannedMinutes: 255, tasksLeft: 6,
            tasks: tasks,
            blocks: [
                .init(id: "b1", taskId: "methods", title: "Methods draft", start: at(10, 5), minutes: 90, done: false, area: university,
                      trip: .init(place: "Library", minutes: 12)),
                .init(id: "b2", taskId: "review", title: "Review onboarding PR", start: at(13, 15), minutes: 45, done: false, area: korvant),
                .init(id: "b3", taskId: "sds", title: "Fix the SDS import", start: at(14, 15), minutes: 60, done: false, area: chemwatch),
                .init(id: "b4", taskId: "timesheet", title: "Send the timesheet", start: at(16, 0), minutes: 15, done: false, area: paperless),
            ],
            commitments: [.init(id: "c1", title: "Supervision", start: at(12, 0), end: at(13, 0))],
            focus: nil,
            week: [
                WidgetSnapshot.Day(
                    date: date, capacityMinutes: 450, plannedMinutes: 255,
                    slices: tasks.map { .init(colour: $0.area?.colour, minutes: $0.estimateMinutes ?? 0) }, deadlines: 0),
                day(1, 510, [("teal", 180), ("violet", 120), ("green", 30)], 0),
                day(2, 360, [("rose", 120), ("violet", 60)], 0),
                day(3, 420, [("violet", 240), ("teal", 120), ("orange", 60)], 1),
                day(4, 510, [("teal", 90), ("rose", 60)], 1),
                day(5, 120, [("green", 60)], 0),
                day(6, 0, [], 0),
            ],
            deadlines: [
                .init(id: "d1", title: "Methods draft", date: next[safe: 2] ?? date, area: university),
                .init(id: "d2", title: "Onboarding handover", date: next[safe: 3] ?? date, area: korvant),
                .init(id: "d3", title: "Book the rail pass", date: next[safe: 5] ?? date, area: personal),
            ],
            brainDump: 6, ticked: nil)
    }
}

extension Array {
    subscript(safe index: Int) -> Element? { indices.contains(index) ? self[index] : nil }
}
