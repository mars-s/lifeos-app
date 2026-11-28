use std::{fs, path::PathBuf};

use serde::{Deserialize, Serialize};

const APP_GROUP: &str = "BFKXU8H6X5.com.marss.lifeos";

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PendingTick {
    task_id: String,
    at: f64,
}

fn group_folder() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|home| {
        PathBuf::from(home)
            .join("Library/Group Containers")
            .join(APP_GROUP)
    })
}

fn ticks_file() -> Option<PathBuf> {
    group_folder().map(|folder| folder.join("ticks.json"))
}

fn read_ticks() -> Vec<PendingTick> {
    ticks_file()
        .and_then(|file| fs::read(file).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn remaining(ticks: Vec<PendingTick>, sent: &[String]) -> Vec<PendingTick> {
    ticks
        .into_iter()
        .filter(|tick| !sent.contains(&tick.task_id))
        .collect()
}

#[cfg(target_os = "macos")]
mod bridge {
    unsafe extern "C" {
        fn lifeos_widgets_write(bytes: *const u8, length: isize) -> bool;
        fn lifeos_widgets_reload();
    }

    pub(super) fn write(json: &str) -> bool {
        let Ok(length) = isize::try_from(json.len()) else {
            return false;
        };
        // SAFETY: the pointer and length describe `json`, which outlives the call; the Swift side copies the bytes.
        unsafe { lifeos_widgets_write(json.as_ptr(), length) }
    }

    pub(super) fn reload() {
        // SAFETY: the Swift function takes no arguments and only asks WidgetKit to reload.
        unsafe { lifeos_widgets_reload() }
    }
}

#[cfg(not(target_os = "macos"))]
mod bridge {
    pub(super) fn write(_json: &str) -> bool {
        false
    }

    pub(super) fn reload() {}
}

#[tauri::command]
pub(crate) fn write_widget_snapshot(json: &str) -> Result<(), String> {
    if bridge::write(json) {
        Ok(())
    } else {
        Err("The widget snapshot could not be written".to_owned())
    }
}

#[tauri::command]
pub(crate) fn pending_widget_ticks() -> Vec<String> {
    read_ticks().into_iter().map(|tick| tick.task_id).collect()
}

#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri deserialises command arguments into owned values"
)]
pub(crate) fn clear_widget_ticks(task_ids: Vec<String>) {
    let Some(file) = ticks_file() else { return };
    let left = remaining(read_ticks(), &task_ids);
    if let Ok(bytes) = serde_json::to_vec(&left) {
        if fs::write(file, bytes).is_ok() {
            bridge::reload();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{PendingTick, remaining};

    #[test]
    fn sent_ticks_leave_the_queue() {
        let ticks: Vec<PendingTick> =
            serde_json::from_str(r#"[{"taskId":"a","at":1},{"taskId":"b","at":2}]"#)
                .expect("ticks parse");
        let left = remaining(ticks, &["a".to_owned()]);
        assert_eq!(
            left.iter()
                .map(|tick| tick.task_id.as_str())
                .collect::<Vec<_>>(),
            ["b"],
            "only the unsent tick stays"
        );
    }
}
