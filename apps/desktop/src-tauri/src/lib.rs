mod haptics;

/// Opens the main window and blocks until the app quits.
///
/// # Errors
///
/// Returns an error if Tauri cannot create the window or its webview.
pub fn run() -> tauri::Result<()> {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![haptics::haptic])
        .run(tauri::generate_context!())
}
