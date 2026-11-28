import Foundation
import WidgetKit

@_cdecl("lifeos_widgets_write")
public func lifeosWidgetsWrite(_ bytes: UnsafePointer<UInt8>, _ length: Int) -> Bool {
    do {
        try WidgetStore.writeRaw(Data(bytes: bytes, count: length))
    } catch {
        return false
    }
    WidgetCenter.shared.reloadAllTimelines()
    return true
}

@_cdecl("lifeos_widgets_reload")
public func lifeosWidgetsReload() {
    WidgetCenter.shared.reloadAllTimelines()
}
