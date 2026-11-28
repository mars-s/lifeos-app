import Foundation

public enum Format {
    public static func minutes(_ value: Double) -> String {
        let whole = Int(value.rounded())
        return "\(whole / 60):" + String(format: "%02d", whole % 60)
    }

    public static func clock(_ minuteOfDay: Double) -> String {
        let whole = Int(minuteOfDay.rounded())
        let hour = (whole / 60) % 24
        let minute = whole % 60
        let shown = (hour + 11) % 12 + 1
        let meridiem = hour < 12 ? "am" : "pm"
        return minute == 0 ? "\(shown) \(meridiem)" : "\(shown):" + String(format: "%02d", minute) + " \(meridiem)"
    }

    public static func clockWithMinutes(_ minuteOfDay: Double) -> String {
        let whole = Int(minuteOfDay.rounded())
        let hour = (whole / 60) % 24
        return "\((hour + 11) % 12 + 1):" + String(format: "%02d", whole % 60) + (hour < 12 ? " am" : " pm")
    }

    public static func countdown(_ ms: Double) -> String {
        let seconds = Int((ms / 1000).rounded(.up))
        return "\(seconds / 60):" + String(format: "%02d", seconds % 60)
    }
}
