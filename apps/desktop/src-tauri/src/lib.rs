/// Opens the main window and blocks until the app quits.
///
/// # Errors
///
/// Returns an error if Tauri cannot create the window or its webview.
pub fn run() -> tauri::Result<()> {
    tauri::Builder::default().run(tauri::generate_context!())
}
