#[cfg(target_os = "macos")]
mod calendar;
mod capture;
mod convex;
mod haptics;
mod permissions;
mod setup;
mod things_import;

use std::sync::Arc;

use tauri::{App, AppHandle, Manager, RunEvent, Url, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_opener::OpenerExt;

const MAIN_WINDOW: &str = "main";

/// Opens the main window and blocks until the app quits.
///
/// Closing the main window hides it, so the menu bar icon and quick capture keep working.
///
/// # Errors
///
/// Returns an error if Tauri cannot create the window or its webview.
pub fn run() -> tauri::Result<()> {
    tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            haptics::haptic,
            capture::hide_capture,
            capture::show_capture,
            permissions::permissions,
            permissions::request_permission,
            permissions::onboarded,
            permissions::finish_onboarding,
            permissions::sync_report,
            permissions::import_things_now
        ])
        .setup(|app| Ok(set_up(app)?))
        .build(tauri::generate_context!())?
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if matches!(event, RunEvent::Reopen { .. }) {
                bring_forward(app);
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
    Ok(())
}

fn set_up(app: &App) -> tauri::Result<()> {
    open_main_window(app.handle())?;
    capture::start(app)?;
    let handle = app.handle().clone();
    app.deep_link().on_open_url(move |_| bring_forward(&handle));
    let (setup, wakes) = setup::Setup::load(&app.path().app_config_dir()?);
    let setup = Arc::new(setup);
    app.manage(Arc::clone(&setup));
    things_import::start(Arc::clone(&setup), wakes.things);
    #[cfg(target_os = "macos")]
    calendar::start(setup, wakes.calendar);
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
    let window = WebviewWindowBuilder::from_config(app, config)?
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
    let kept = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            if let Err(error) = kept.hide() {
                eprintln!("could not hide the LifeOS window: {error}");
            }
        }
    });
    Ok(())
}

pub(crate) fn bring_forward(app: &AppHandle) {
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
