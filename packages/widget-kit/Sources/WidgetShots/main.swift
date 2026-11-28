import AppKit
import CoreText
import LifeOSWidgetKit
import SwiftUI

let output = URL(fileURLWithPath: CommandLine.arguments.dropFirst().first ?? ".")
let fonts = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../../Fonts").standardized
for file in (try? FileManager.default.contentsOfDirectory(at: fonts, includingPropertiesForKeys: nil)) ?? [] where file.pathExtension == "ttf" {
    CTFontManagerRegisterFontsForURL(file as CFURL, .process, nil)
}

let clock = DayClock(timeZone: TimeZone.current.identifier)
let now = clock.moment(iso: clock.isoDate(of: .now), minute: 9 * 60 + 41) ?? .now
let snapshot = Sample.snapshot(on: now)

struct Shot<Content: View>: View {
    let dark: Bool
    let width: CGFloat
    let height: CGFloat
    let content: Content

    var body: some View {
        let ink = Ink.of(mode: .colour(dark: dark))
        content
            .environment(\.ink, ink)
            .foregroundStyle(ink.ink)
            .padding(16)
            .frame(width: width, height: height)
            .background(ink.tile, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
            .padding(24)
            .background(dark ? Color(white: 0.1) : Color(white: 0.9))
            .environment(\.colorScheme, dark ? .dark : .light)
    }
}

@MainActor
func save<Content: View>(_ name: String, width: CGFloat, height: CGFloat, @ViewBuilder _ content: () -> Content) {
    for dark in [false, true] {
        let renderer = ImageRenderer(content: Shot(dark: dark, width: width, height: height, content: content()))
        renderer.scale = 2
        guard let image = renderer.nsImage, let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff),
            let png = bitmap.representation(using: .png, properties: [:])
        else { continue }
        try? png.write(to: output.appendingPathComponent("\(name)\(dark ? "-dark" : "").png"))
    }
}

MainActor.assumeIsolated {
    save("widgets-built-mac-week", width: 704, height: 360) { WeekTile(snapshot: snapshot, now: now) }
    save("widgets-built-mac-today", width: 344, height: 360) { TodayTile(snapshot: snapshot, now: now, large: true) }
}
