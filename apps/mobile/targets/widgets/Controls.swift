import SwiftUI
import WidgetKit

@available(iOS 18.0, *)
struct BrainDumpControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "brain-dump-control") {
            ControlWidgetButton(action: OpenCaptureIntent()) {
                Label("Brain Dump", systemImage: "tray.fill")
            }
        }
        .displayName("Brain Dump")
        .description("Add a thought to LifeOS.")
    }
}
