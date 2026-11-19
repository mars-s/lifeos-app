//! Tells Avi through a macOS notification when a timed Focus Session or Break runs out.
//!
//! The alert is scheduled with macOS ahead of time, so it arrives even while the window sleeps.
//! macOS shows it only while `LifeOS` is not the frontmost app.

use serde::Deserialize;

use crate::permissions::Status;

/// One "time is up" alert: what it says, and how many seconds from now it shows.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Alert {
    in_seconds: f64,
    title: String,
    body: String,
}

/// Schedules the alert, replacing any alert still waiting.
#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri hands a command its arguments by value"
)]
pub(crate) fn schedule_alert(alert: Alert) {
    platform::schedule(&alert);
}

/// Drops the alert still waiting, if there is one. A delivered alert stays in Notification Centre.
#[tauri::command]
pub(crate) fn cancel_alert() {
    platform::cancel();
}

/// Whether macOS lets `LifeOS` show notifications. It never shows a prompt.
pub(crate) fn status() -> Status {
    platform::status()
}

/// Asks macOS to let `LifeOS` show notifications, waits for Avi's answer and returns it.
pub(crate) fn request() -> Status {
    platform::request()
}

#[cfg(target_os = "macos")]
mod platform {
    use std::{path::Path, ptr::NonNull, sync::mpsc};

    use block2::RcBlock;
    use objc2::{rc::Retained, runtime::Bool};
    use objc2_foundation::{NSArray, NSBundle, NSError, NSString};
    use objc2_user_notifications::{
        UNAuthorizationOptions, UNAuthorizationStatus, UNMutableNotificationContent,
        UNNotificationRequest, UNNotificationSettings, UNNotificationSound, UNNotificationTrigger,
        UNTimeIntervalNotificationTrigger, UNUserNotificationCenter,
    };

    use super::{Alert, Status};

    const ALERT_ID: &str = "focus-time-up";
    /// macOS refuses a trigger that is not in the future.
    const SOONEST_SECONDS: f64 = 1.0;

    /// The notification centre, only inside a bundled app: a bare `cargo run` binary has none.
    fn center() -> Option<Retained<UNUserNotificationCenter>> {
        let path = NSBundle::mainBundle().bundlePath().to_string();
        let bundled = Path::new(&path)
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("app"));
        bundled.then(UNUserNotificationCenter::currentNotificationCenter)
    }

    pub(super) fn status() -> Status {
        let Some(center) = center() else {
            return Status::Missing;
        };
        let (sender, answer) = mpsc::channel();
        let completion: RcBlock<dyn Fn(NonNull<UNNotificationSettings>)> =
            RcBlock::new(move |settings: NonNull<UNNotificationSettings>| {
                // SAFETY: UserNotifications passes a live settings object for the length of the call.
                let settings = unsafe { settings.as_ref() };
                sender.send(settings.authorizationStatus()).ok();
            });
        center.getNotificationSettingsWithCompletionHandler(&completion);
        match answer.recv() {
            Ok(UNAuthorizationStatus::NotDetermined) => Status::NotAsked,
            Ok(UNAuthorizationStatus::Denied) | Err(_) => Status::Denied,
            Ok(_) => Status::Granted,
        }
    }

    pub(super) fn request() -> Status {
        let Some(center) = center() else {
            return Status::Missing;
        };
        let (sender, answer) = mpsc::channel();
        let completion: RcBlock<dyn Fn(Bool, *mut NSError)> =
            RcBlock::new(move |granted: Bool, _error: *mut NSError| {
                sender.send(granted.as_bool()).ok();
            });
        center.requestAuthorizationWithOptions_completionHandler(
            UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound,
            &completion,
        );
        match answer.recv() {
            Ok(true) => Status::Granted,
            Ok(false) | Err(_) => status(),
        }
    }

    pub(super) fn schedule(alert: &Alert) {
        let Some(center) = center() else {
            return;
        };
        let content = UNMutableNotificationContent::new();
        content.setTitle(&NSString::from_str(&alert.title));
        content.setBody(&NSString::from_str(&alert.body));
        content.setSound(Some(&UNNotificationSound::defaultSound()));
        let trigger = UNTimeIntervalNotificationTrigger::triggerWithTimeInterval_repeats(
            alert.in_seconds.max(SOONEST_SECONDS),
            false,
        );
        let trigger: &UNNotificationTrigger = &trigger;
        let request = UNNotificationRequest::requestWithIdentifier_content_trigger(
            &NSString::from_str(ALERT_ID),
            &content,
            Some(trigger),
        );
        center.addNotificationRequest_withCompletionHandler(&request, None);
    }

    pub(super) fn cancel() {
        let Some(center) = center() else {
            return;
        };
        let ids = NSArray::from_retained_slice(&[NSString::from_str(ALERT_ID)]);
        center.removePendingNotificationRequestsWithIdentifiers(&ids);
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use super::{Alert, Status};

    pub(super) fn status() -> Status {
        Status::Missing
    }

    pub(super) fn request() -> Status {
        Status::Missing
    }

    pub(super) fn schedule(_alert: &Alert) {}

    pub(super) fn cancel() {}
}

#[cfg(test)]
mod tests {
    use super::Alert;

    #[test]
    fn an_alert_parses_from_what_the_web_sends() {
        let alert: Alert = serde_json::from_str(
            r#"{"inSeconds": 1499.5, "title": "Focus Session complete", "body": "Write chapter two. Time for a break."}"#,
        )
        .expect("the web's alert parses");
        assert_eq!(
            alert,
            Alert {
                in_seconds: 1499.5,
                title: "Focus Session complete".to_owned(),
                body: "Write chapter two. Time for a break.".to_owned(),
            },
            "every field arrives"
        );
    }
}
