use serde::Deserialize;

/// A trackpad feedback pattern, named after `NSHapticFeedbackPattern`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum HapticPattern {
    Alignment,
    LevelChange,
    Generic,
}

/// Plays one pattern on the Force Touch trackpad. Does nothing off macOS.
#[tauri::command]
pub(crate) fn haptic(pattern: HapticPattern) {
    perform(pattern);
}

#[cfg(target_os = "macos")]
fn perform(pattern: HapticPattern) {
    use objc2_app_kit::{
        NSHapticFeedbackManager, NSHapticFeedbackPattern, NSHapticFeedbackPerformanceTime,
        NSHapticFeedbackPerformer,
    };

    let pattern = match pattern {
        HapticPattern::Alignment => NSHapticFeedbackPattern::Alignment,
        HapticPattern::LevelChange => NSHapticFeedbackPattern::LevelChange,
        HapticPattern::Generic => NSHapticFeedbackPattern::Generic,
    };
    NSHapticFeedbackManager::defaultPerformer()
        .performFeedbackPattern_performanceTime(pattern, NSHapticFeedbackPerformanceTime::Now);
}

#[cfg(not(target_os = "macos"))]
fn perform(_pattern: HapticPattern) {}

#[cfg(test)]
mod tests {
    use super::HapticPattern;

    #[test]
    fn patterns_parse_from_the_names_the_web_sends() {
        for (name, want) in [
            ("alignment", HapticPattern::Alignment),
            ("levelChange", HapticPattern::LevelChange),
            ("generic", HapticPattern::Generic),
        ] {
            let got: HapticPattern =
                serde_json::from_str(&format!("\"{name}\"")).expect("a known pattern name parses");
            assert_eq!(got, want, "pattern name {name:?}");
        }
    }
}
