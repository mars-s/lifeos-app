import Foundation
import Testing
@testable import LifeOSWidgetKit

private let sydney = "Australia/Sydney"
private let json = """
{"v":1,"writtenAt":1764460000000,"convexUrl":"https://example.convex.cloud","date":"2026-11-30","timeZone":"Australia/Sydney",
"workingHours":{"startMinute":540,"endMinute":1050},"capacityMinutes":450,"plannedMinutes":105,"tasksLeft":2,
"tasks":[{"id":"a","title":"Methods draft","area":{"name":"University","colour":"violet"},"estimateMinutes":90},{"id":"b","title":"Book the physio","estimateMinutes":15}],
"blocks":[{"id":"w","taskId":"a","title":"Methods draft","start":1795993500000,"minutes":90,"done":false,"trip":{"place":"Library","minutes":12}}],
"commitments":[{"id":"c","title":"Supervision","start":1796000400000,"end":1796004000000}],
"focus":null,"week":[{"date":"2026-11-30","capacityMinutes":450,"plannedMinutes":105,"slices":[{"colour":"violet","minutes":90},{"minutes":15}],"deadlines":0}],
"deadlines":[{"id":"d","title":"Handover","date":"2026-12-04"}],"brainDump":3}
"""

private func moment(_ hour: Int, _ minute: Int) -> Date {
    DayClock(timeZone: sydney).moment(iso: "2026-11-30", minute: Double(hour * 60 + minute))!
}

@Test func decodesWhatTheAppsWrite() throws {
    let snapshot = try WidgetSnapshot.decode(Data(json.utf8))
    #expect(snapshot.tasks.count == 2)
    #expect(snapshot.tasks[1].area == nil)
    #expect(snapshot.week[0].slices[1].colour == nil)
    #expect(snapshot.daysUntil(snapshot.deadlines[0]) == 4)
}

@Test func capacityCountsDownWithTheClock() throws {
    let snapshot = try WidgetSnapshot.decode(Data(json.utf8))
    #expect(snapshot.capacityLeft(at: moment(8, 0)) == 450 - 105)
    #expect(snapshot.freeMinutesAhead(at: moment(12, 30)) == 270)
    #expect(snapshot.capacityLeft(at: moment(12, 30)) == 270 - 105)
    #expect(snapshot.capacityState(at: moment(17, 0)) == .over)
}

@Test func ticksLeaveTheCountAndThePlan() throws {
    let snapshot = try WidgetSnapshot.decode(Data(json.utf8)).marking("b")
    #expect(snapshot.tasksLeftNow == 1)
    #expect(snapshot.openPlannedMinutes == 90)
}

@Test func nextBlockAndTrip() throws {
    let snapshot = try WidgetSnapshot.decode(Data(json.utf8))
    let block = try #require(snapshot.nextBlock(after: moment(9, 41)))
    #expect(snapshot.clock.minute(ofMs: block.start) == 10 * 60 + 5)
    let leave = try #require(snapshot.leaveMs(for: block))
    #expect(snapshot.clock.minute(ofMs: leave) == Double(9 * 60 + 53))
    #expect(snapshot.spans().map(\.kind) == [.trip, .block, .commitment])
    #expect(snapshot.nextBlock(after: moment(11, 0)) == nil)
}

@Test func glyphsAndFormats() {
    #expect(Glyphs.dots("4:15").columns == 5 + 1 + 1 + 1 + 5 + 1 + 5)
    #expect(Format.minutes(255) == "4:15")
    #expect(Format.clock(9 * 60) == "9 am")
    #expect(Format.clockWithMinutes(9 * 60 + 53) == "9:53 am")
    #expect(Format.countdown(18 * 60_000 + 41_200) == "18:42")
}

@Test func focusRemainingWhileRunningAndPaused() {
    let start = moment(10, 0).timeIntervalSince1970 * 1000
    let running = WidgetSnapshot.Focus(taskId: "a", title: "Methods", kind: "focus", start: start, pausedMs: 60_000, plannedMinutes: 25)
    #expect(running.remainingMs(at: moment(10, 7)) == 19 * 60_000)
    var paused = running
    paused.pausedAt = start + 10 * 60_000
    #expect(paused.remainingMs(at: moment(11, 0)) == 16 * 60_000)
    #expect(paused.endDate == nil)
}
