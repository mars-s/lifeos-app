// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "LifeOSWidgetKit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "LifeOSWidgetKit", targets: ["LifeOSWidgetKit"])],
    targets: [
        .target(name: "LifeOSWidgetKit"),
        .testTarget(name: "LifeOSWidgetKitTests", dependencies: ["LifeOSWidgetKit"]),
    ]
)
