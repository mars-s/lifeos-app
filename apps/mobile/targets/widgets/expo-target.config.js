module.exports = (config) => ({
  type: "widget",
  name: "LifeOSWidgets",
  displayName: "LifeOS",
  bundleIdentifier: ".widgets",
  deploymentTarget: "17.0",
  frameworks: ["SwiftUI", "WidgetKit", "ActivityKit", "AppIntents"],
  colors: {
    $accent: { color: "#282521", darkColor: "#E6E8EB" },
    $widgetBackground: { color: "#FEFCF9", darkColor: "#18191C" },
  },
  entitlements: {
    "com.apple.security.application-groups": config.ios.entitlements["com.apple.security.application-groups"],
    "keychain-access-groups": ["$(AppIdentifierPrefix)com.marss.lifeos.shared"],
  },
});
