//! Reads and asks for the macOS permissions `LifeOS` needs. Nothing here prompts unless Avi asked it to.

use std::{
    env, fs, io,
    path::{Path, PathBuf},
    process::Command,
    sync::Arc,
};

use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

use crate::{
    convex, notifications,
    setup::{Permission, Run, Setup},
};

const THINGS_CONTAINER_SUFFIX: &str = ".com.culturedcode.ThingsMac";
/// The privacy service macOS files "access data from other apps" under, as `tccutil` names it.
const APP_DATA_SERVICE: &str = "SystemPolicyAppData";
const CALENDAR_SETTINGS: &str =
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars";
const NOTIFICATION_SETTINGS: &str =
    "x-apple.systempreferences:com.apple.Notifications-Settings.extension";
const FULL_DISK_SETTINGS: &str =
    "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles";

/// Where one permission stands. `Missing` means there is nothing on this Mac to ask for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Status {
    Granted,
    Denied,
    NotAsked,
    Missing,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Permissions {
    calendar: Status,
    things_data: Status,
    keychain: Status,
    notifications: Status,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SyncReport {
    things: Option<Run>,
    calendar: Option<Run>,
}

/// The live status of every permission. It never shows a macOS prompt.
///
/// A calendar switched on in System Settings since the last look starts the first send.
#[tauri::command]
pub(crate) async fn permissions(setup: State<'_, Arc<Setup>>) -> Result<Permissions, String> {
    let setup = Arc::clone(&setup);
    blocking(move || {
        let calendar = status(&setup, Permission::Calendar);
        if calendar == Status::Granted && setup.calendar.last().is_none() {
            setup.calendar.wake();
        }
        Permissions {
            calendar,
            things_data: status(&setup, Permission::ThingsData),
            keychain: status(&setup, Permission::Keychain),
            notifications: status(&setup, Permission::Notifications),
        }
    })
    .await
}

/// Asks macOS for one permission, waits for Avi's answer and returns where it stands.
///
/// When macOS will not ask again, this opens the System Settings pane that holds the switch.
#[tauri::command]
pub(crate) async fn request_permission(
    app: AppHandle,
    setup: State<'_, Arc<Setup>>,
    permission: Permission,
) -> Result<Status, String> {
    let setup = Arc::clone(&setup);
    blocking(move || {
        let before = status(&setup, permission);
        let after = request(&app, &setup, permission, before);
        if after == Status::Granted {
            setup.wake_all();
        }
        after
    })
    .await
}

#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri hands a command its state by value"
)]
pub(crate) fn onboarded(setup: State<'_, Arc<Setup>>) -> bool {
    setup.onboarded()
}

#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri hands a command its state by value"
)]
pub(crate) fn finish_onboarding(setup: State<'_, Arc<Setup>>) {
    setup.finish_onboarding();
    setup.wake_all();
}

/// How the last Things Import and the last Apple Calendar send ended on this Mac.
#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri hands a command its state by value"
)]
pub(crate) fn sync_report(setup: State<'_, Arc<Setup>>) -> SyncReport {
    SyncReport {
        things: setup.things.last(),
        calendar: setup.calendar.last(),
    }
}

#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri hands a command its state by value"
)]
pub(crate) fn import_things_now(setup: State<'_, Arc<Setup>>) {
    setup.things.wake();
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> T + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| format!("the permission check stopped early: {error}"))
}

fn status(setup: &Setup, permission: Permission) -> Status {
    match permission {
        Permission::Calendar => calendar_status(),
        Permission::ThingsData => match things_container() {
            None => Status::Missing,
            Some(_) if !setup.asked(permission) => Status::NotAsked,
            Some(container) => readable(&container),
        },
        Permission::Keychain => {
            if !convex::token_stored() {
                Status::Missing
            } else if !setup.asked(permission) {
                Status::NotAsked
            } else if setup.token_readable() {
                Status::Granted
            } else {
                Status::Denied
            }
        }
        Permission::Notifications => notifications::status(),
    }
}

fn request(app: &AppHandle, setup: &Setup, permission: Permission, before: Status) -> Status {
    match (permission, before) {
        (_, Status::Granted | Status::Missing) => before,
        (Permission::Calendar, Status::NotAsked) => ask_calendar(),
        (Permission::Calendar, Status::Denied) => {
            open_settings(app, CALENDAR_SETTINGS);
            before
        }
        (Permission::ThingsData, Status::NotAsked) => {
            setup.mark_asked(permission);
            status(setup, permission)
        }
        (Permission::ThingsData, Status::Denied) => {
            if forget_app_data_answer(&app.config().identifier) {
                status(setup, permission)
            } else {
                open_settings(app, FULL_DISK_SETTINGS);
                before
            }
        }
        (Permission::Notifications, Status::NotAsked) => notifications::request(),
        (Permission::Notifications, Status::Denied) => {
            let pane = format!("{NOTIFICATION_SETTINGS}?id={}", app.config().identifier);
            open_settings(app, &pane);
            before
        }
        (Permission::Keychain, Status::NotAsked | Status::Denied) => {
            setup.mark_asked(permission);
            if setup.token().is_ok() {
                Status::Granted
            } else {
                Status::Denied
            }
        }
    }
}

#[cfg(target_os = "macos")]
fn calendar_status() -> Status {
    use crate::calendar::Access;

    match crate::calendar::access() {
        Access::Granted => Status::Granted,
        Access::Undecided => Status::NotAsked,
        Access::Refused => Status::Denied,
    }
}

#[cfg(not(target_os = "macos"))]
fn calendar_status() -> Status {
    Status::Missing
}

#[cfg(target_os = "macos")]
fn ask_calendar() -> Status {
    crate::calendar::request_access();
    calendar_status()
}

#[cfg(not(target_os = "macos"))]
fn ask_calendar() -> Status {
    Status::Missing
}

/// The Things group container, found by name alone so macOS has nothing to guard yet.
pub(crate) fn things_container() -> Option<PathBuf> {
    let containers = PathBuf::from(env::var_os("HOME")?).join("Library/Group Containers");
    things_container_in(&containers)
}

fn things_container_in(group_containers: &Path) -> Option<PathBuf> {
    fs::read_dir(group_containers)
        .ok()?
        .flatten()
        .find(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .ends_with(THINGS_CONTAINER_SUFFIX)
        })
        .map(|entry| entry.path())
}

/// Opening another app's container is what makes macOS ask, the first time only.
fn readable(container: &Path) -> Status {
    match fs::read_dir(container) {
        Ok(_) => Status::Granted,
        Err(error) if error.kind() == io::ErrorKind::NotFound => Status::Missing,
        Err(_) => Status::Denied,
    }
}

/// Makes macOS forget a "Don't Allow", so the next read asks again. False when macOS refuses to.
fn forget_app_data_answer(bundle_id: &str) -> bool {
    Command::new("/usr/bin/tccutil")
        .args(["reset", APP_DATA_SERVICE, bundle_id])
        .output()
        .is_ok_and(|output| output.status.success())
}

fn open_settings(app: &AppHandle, pane: &str) {
    if let Err(error) = app.opener().open_url(pane, None::<&str>) {
        eprintln!("permissions: could not open System Settings at {pane}: {error}");
    }
}

#[cfg(test)]
mod tests {
    use std::{env, fs};

    use super::{Status, readable, things_container_in};

    #[test]
    fn the_things_container_is_found_by_name_without_opening_it() {
        let root = env::temp_dir().join(format!("lifeos-permissions-{}", std::process::id()));
        fs::remove_dir_all(&root).ok();
        let things = root.join("JLMPQHK86H.com.culturedcode.ThingsMac");
        fs::create_dir_all(&things).expect("the fake Things container");
        fs::create_dir_all(root.join("group.com.apple.notes")).expect("another container");
        assert_eq!(
            things_container_in(&root),
            Some(things.clone()),
            "the Things container"
        );
        assert_eq!(readable(&things), Status::Granted, "a folder we may open");
        assert_eq!(
            readable(&root.join("gone")),
            Status::Missing,
            "a folder that is not there"
        );
        assert_eq!(
            things_container_in(&root.join("missing")),
            None,
            "no Group Containers folder"
        );
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn statuses_use_the_names_the_web_reads() {
        for (status, name) in [
            (Status::Granted, "granted"),
            (Status::Denied, "denied"),
            (Status::NotAsked, "notAsked"),
            (Status::Missing, "missing"),
        ] {
            let json = serde_json::to_string(&status).expect("a status serialises");
            assert_eq!(json, format!("\"{name}\""), "status {status:?}");
        }
    }
}
