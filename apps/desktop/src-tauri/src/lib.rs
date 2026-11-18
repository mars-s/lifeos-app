mod haptics;

use tauri::{App, AppHandle, Manager, Url, WebviewWindowBuilder};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_opener::OpenerExt;

const MAIN_WINDOW: &str = "main";

/// Opens the main window and blocks until the app quits.
///
/// # Errors
///
/// Returns an error if Tauri cannot create the window or its webview.
pub fn run() -> tauri::Result<()> {
    tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![haptics::haptic])
        .setup(|app| Ok(set_up(app)?))
        .run(tauri::generate_context!())
}

fn set_up(app: &App) -> tauri::Result<()> {
    open_main_window(app.handle())?;
    let handle = app.handle().clone();
    app.deep_link().on_open_url(move |_| bring_forward(&handle));
    Ok(())
}

fn open_main_window(app: &AppHandle) -> tauri::Result<()> {
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == MAIN_WINDOW)
        .expect("tauri.conf.json declares the main window");
    let handle = app.clone();
    WebviewWindowBuilder::from_config(app, config)?
        .on_navigation(move |url| {
            if tauri::is_dev() || stays_in_app(url) {
                return true;
            }
            if let Err(error) = handle.opener().open_url(url.as_str(), None::<&str>) {
                eprintln!("could not open {url} in the browser: {error}");
            }
            false
        })
        .build()?;
    Ok(())
}

fn bring_forward(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };
    let shown = window
        .unminimize()
        .and_then(|()| window.show())
        .and_then(|()| window.set_focus());
    if let Err(error) = shown {
        eprintln!("could not bring LifeOS forward: {error}");
    }
}

fn stays_in_app(url: &Url) -> bool {
    match url.scheme() {
        "tauri" | "about" | "blob" | "data" => true,
        "http" | "https" => url.host_str() == Some("tauri.localhost"),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use tauri::Url;

    use super::stays_in_app;

    #[test]
    fn only_the_app_bundle_loads_in_the_window() {
        for (url, want) in [
            ("tauri://localhost/today", true),
            ("http://tauri.localhost/today", true),
            ("about:blank", true),
            (
                "https://github.com/login/oauth/authorize?client_id=x",
                false,
            ),
            (
                "https://curious-pigeon-412.ap-southeast-2.convex.site/auth/mac",
                false,
            ),
            ("mailto:avi@example.com", false),
        ] {
            let parsed = Url::parse(url).expect("a valid URL");
            assert_eq!(stays_in_app(&parsed), want, "{url}");
        }
    }
}
