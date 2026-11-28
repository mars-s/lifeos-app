import AppIntents
import Foundation

@available(iOS 18.0, *)
struct OpenCaptureIntent: AppIntent {
    static let title: LocalizedStringResource = "Add to Brain Dump"
    static let description = IntentDescription("Opens quick capture in LifeOS.")
    static let openAppWhenRun = true

    func perform() async throws -> some IntentResult {
        UserDefaults(suiteName: "group.com.marss.lifeos")?.set("/capture", forKey: "route")
        return .result()
    }
}
