//! Quick capture from any app: a global shortcut, a small floating window and the menu bar icon.

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{
    App, AppHandle, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

const WINDOW: &str = "capture";
const TRAY: &str = "lifeos";
const MENU_CAPTURE: &str = "capture";
const MENU_OPEN: &str = "open";

/// The window is larger than the panel it draws, so the panel's shadow has room.
const WIDTH: f64 = 720.0;
const HEIGHT: f64 = 220.0;

/// How far down the screen the window sits, as a share of the screen height.
const TOP_SHARE: f64 = 0.2;

/// Control, Shift and Space. Things, Raycast, Spotlight and the input source switcher leave it free.
fn shortcut() -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space)
}

/// Builds the hidden capture window, registers the global shortcut and adds the menu bar icon.
///
/// A shortcut another app already holds is logged and skipped, so the app still starts.
///
/// # Errors
///
/// Returns an error if Tauri cannot create the window, the plugin or the menu bar icon.
pub(crate) fn start(app: &App) -> tauri::Result<()> {
    build_window(app.handle())?;
    app.handle().plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(|app, pressed, event| {
                if *pressed == shortcut() && event.state() == ShortcutState::Pressed {
                    toggle(app);
                }
            })
            .build(),
    )?;
    if let Err(error) = app.global_shortcut().register(shortcut()) {
        eprintln!("could not register the quick capture shortcut: {error}");
    }
    build_tray(app)
}

/// Where focus goes when the capture window hides.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FocusAfter {
    /// Back to the app that was in front before quick capture opened.
    PreviousApp,
    /// Wherever the user has already put it, such as an app they clicked.
    Untouched,
}

/// Hides the capture window and hands focus back to the app that had it.
#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri hands a command its AppHandle by value"
)]
pub(crate) fn hide_capture(app: AppHandle) {
    hide(&app, FocusAfter::PreviousApp);
}

/// Shows the capture window again, for a save that failed after it closed.
#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri hands a command its AppHandle by value"
)]
pub(crate) fn show_capture(app: AppHandle) {
    show(&app);
}

fn build_window(app: &AppHandle) -> tauri::Result<()> {
    let window = WebviewWindowBuilder::new(app, WINDOW, WebviewUrl::App("capture".into()))
        .title("Quick capture")
        .inner_size(WIDTH, HEIGHT)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        .visible(false)
        .build()?;
    let handle = app.clone();
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Focused(false)) {
            hide(&handle, FocusAfter::Untouched);
        }
    });
    Ok(())
}

fn build_tray(app: &App) -> tauri::Result<()> {
    let capture = MenuItem::with_id(
        app,
        MENU_CAPTURE,
        "Quick Capture",
        true,
        Some("Ctrl+Shift+Space"),
    )?;
    let open = MenuItem::with_id(app, MENU_OPEN, "Open LifeOS", true, None::<&str>)?;
    let quit = PredefinedMenuItem::quit(app, Some("Quit LifeOS"))?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&capture, &open, &separator, &quit])?;
    TrayIconBuilder::with_id(TRAY)
        .icon(Image::from_bytes(include_bytes!("../icons/tray.png"))?)
        .icon_as_template(true)
        .tooltip("LifeOS")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            MENU_CAPTURE => show(app),
            MENU_OPEN => crate::bring_forward(app),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

fn toggle(app: &AppHandle) {
    let Some(window) = app.get_webview_window(WINDOW) else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        hide(app, FocusAfter::PreviousApp);
    } else {
        show(app);
    }
}

fn show(app: &AppHandle) {
    let Some(window) = app.get_webview_window(WINDOW) else {
        return;
    };
    if !window.is_visible().unwrap_or(false) {
        previous_app::remember();
    }
    place(app, &window);
    if let Err(error) = window.show().and_then(|()| window.set_focus()) {
        eprintln!("could not show quick capture: {error}");
    }
}

fn hide(app: &AppHandle, focus: FocusAfter) {
    let Some(window) = app.get_webview_window(WINDOW) else {
        return;
    };
    if !window.is_visible().unwrap_or(false) {
        return;
    }
    if let Err(error) = window.hide() {
        eprintln!("could not hide quick capture: {error}");
    }
    match focus {
        FocusAfter::PreviousApp => previous_app::restore(),
        FocusAfter::Untouched => previous_app::forget(),
    }
}

/// Centres the window near the top of the screen the pointer is on.
fn place(app: &AppHandle, window: &WebviewWindow) {
    let monitor = app
        .cursor_position()
        .ok()
        .and_then(|point| app.monitor_from_point(point.x, point.y).ok().flatten())
        .or_else(|| window.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else {
        return;
    };
    let origin = monitor.position();
    let screen = monitor.size();
    let width = WIDTH * monitor.scale_factor();
    let position = PhysicalPosition::new(
        f64::from(origin.x) + (f64::from(screen.width) - width) / 2.0,
        f64::from(origin.y) + f64::from(screen.height) * TOP_SHARE,
    );
    if let Err(error) = window.set_position(position) {
        eprintln!("could not place quick capture: {error}");
    }
}

/// Remembers which app was in front before quick capture opened, and puts it back after.
#[cfg(target_os = "macos")]
mod previous_app {
    use std::sync::Mutex;

    use objc2::rc::Retained;
    use objc2_app_kit::{NSApplicationActivationOptions, NSRunningApplication, NSWorkspace};

    static PREVIOUS: Mutex<Option<Retained<NSRunningApplication>>> = Mutex::new(None);

    pub(super) fn remember() {
        let ours = NSRunningApplication::currentApplication();
        let front = NSWorkspace::sharedWorkspace()
            .frontmostApplication()
            .filter(|app| **app != *ours);
        *PREVIOUS.lock().expect("the previous app lock is poisoned") = front;
    }

    pub(super) fn forget() {
        *PREVIOUS.lock().expect("the previous app lock is poisoned") = None;
    }

    pub(super) fn restore() {
        let previous = PREVIOUS
            .lock()
            .expect("the previous app lock is poisoned")
            .take();
        if let Some(app) = previous {
            app.activateWithOptions(NSApplicationActivationOptions::empty());
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod previous_app {
    pub(super) fn remember() {}

    pub(super) fn forget() {}

    pub(super) fn restore() {}
}
