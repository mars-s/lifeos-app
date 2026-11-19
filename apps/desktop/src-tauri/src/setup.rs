//! What this Mac remembers about first-run setup, and what its background loops last did.

use std::{
    collections::BTreeSet,
    fs,
    path::{Path, PathBuf},
    sync::{
        Mutex, MutexGuard,
        mpsc::{self, Receiver, Sender},
    },
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

use crate::convex::{self, Token};

const SETUP_FILE: &str = "setup.json";

/// Something macOS guards that `LifeOS` needs before it can work in the background.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Permission {
    Calendar,
    ThingsData,
    Keychain,
}

/// The part of setup that survives a restart, kept as JSON in the app's config folder.
#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Saved {
    onboarded: bool,
    asked: BTreeSet<Permission>,
}

/// How one background run ended. `error` is `None` when it worked.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Run {
    at_ms: i64,
    error: Option<String>,
}

/// One background loop: a way to wake it early, and how its last run ended.
#[derive(Debug)]
pub(crate) struct Worker {
    wake: Sender<()>,
    last: Mutex<Option<Run>>,
}

impl Worker {
    fn new() -> (Self, Receiver<()>) {
        let (wake, woken) = mpsc::channel();
        let worker = Self {
            wake,
            last: Mutex::new(None),
        };
        (worker, woken)
    }

    /// Runs the loop now instead of at its next tick. Does nothing once the loop has ended.
    pub(crate) fn wake(&self) {
        self.wake.send(()).ok();
    }

    pub(crate) fn waker(&self) -> Sender<()> {
        self.wake.clone()
    }

    pub(crate) fn record(&self, outcome: Result<(), String>) {
        *locked(&self.last) = Some(Run {
            at_ms: now_ms(),
            error: outcome.err(),
        });
    }

    pub(crate) fn last(&self) -> Option<Run> {
        locked(&self.last).clone()
    }
}

/// The receiving ends of the wake channels, handed to the loops when they start.
#[derive(Debug)]
pub(crate) struct Wakes {
    pub(crate) things: Receiver<()>,
    pub(crate) calendar: Receiver<()>,
}

/// Setup shared by the Tauri commands and the background loops.
#[derive(Debug)]
pub(crate) struct Setup {
    path: PathBuf,
    saved: Mutex<Saved>,
    token_readable: Mutex<Option<bool>>,
    pub(crate) things: Worker,
    pub(crate) calendar: Worker,
}

impl Setup {
    /// Reads `setup.json` from `config_dir`. A missing or unreadable file means nothing was set up yet.
    pub(crate) fn load(config_dir: &Path) -> (Self, Wakes) {
        let path = config_dir.join(SETUP_FILE);
        let saved = fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        let (things, things_woken) = Worker::new();
        let (calendar, calendar_woken) = Worker::new();
        let setup = Self {
            path,
            saved: Mutex::new(saved),
            token_readable: Mutex::new(None),
            things,
            calendar,
        };
        let wakes = Wakes {
            things: things_woken,
            calendar: calendar_woken,
        };
        (setup, wakes)
    }

    pub(crate) fn onboarded(&self) -> bool {
        locked(&self.saved).onboarded
    }

    pub(crate) fn finish_onboarding(&self) {
        self.change(|saved| saved.onboarded = true);
    }

    /// Whether `LifeOS` has already shown the macOS prompt for this, so touching it again cannot surprise Avi.
    pub(crate) fn asked(&self, permission: Permission) -> bool {
        locked(&self.saved).asked.contains(&permission)
    }

    pub(crate) fn mark_asked(&self, permission: Permission) {
        self.change(|saved| {
            saved.asked.insert(permission);
        });
    }

    /// The Worker token, read only once the Keychain has been asked for.
    pub(crate) fn token(&self) -> Result<Token, String> {
        if !self.asked(Permission::Keychain) {
            return Err("the Keychain has not been asked for the Worker token yet".to_owned());
        }
        let token = convex::read_token();
        *locked(&self.token_readable) = Some(token.is_ok());
        token
    }

    /// Whether the last read of the token worked, reading it now if nothing has read it this launch.
    pub(crate) fn token_readable(&self) -> bool {
        let known = *locked(&self.token_readable);
        known.unwrap_or_else(|| self.token().is_ok())
    }

    pub(crate) fn wake_all(&self) {
        self.things.wake();
        self.calendar.wake();
    }

    fn change(&self, edit: impl FnOnce(&mut Saved)) {
        let mut saved = locked(&self.saved);
        edit(&mut saved);
        let written = self
            .path
            .parent()
            .map_or(Ok(()), fs::create_dir_all)
            .and_then(|()| fs::write(&self.path, serde_json::to_vec(&*saved)?));
        if let Err(error) = written {
            eprintln!("setup: could not save {}: {error}", self.path.display());
        }
    }
}

fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().expect("a setup lock is never poisoned")
}

pub(crate) fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|since| i64::try_from(since.as_millis()).ok())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use std::{env, fs, path::PathBuf};

    use super::{Permission, Setup};

    fn scratch(name: &str) -> PathBuf {
        let dir = env::temp_dir().join(format!("lifeos-setup-{name}-{}", std::process::id()));
        fs::remove_dir_all(&dir).ok();
        dir
    }

    #[test]
    fn a_fresh_mac_has_not_been_onboarded_or_asked() {
        let (setup, _wakes) = Setup::load(&scratch("fresh"));
        assert!(!setup.onboarded(), "no setup file yet");
        assert!(!setup.asked(Permission::ThingsData), "nothing asked yet");
        assert_eq!(
            setup.token().map(|_| ()),
            Err("the Keychain has not been asked for the Worker token yet".to_owned()),
            "the Keychain is left alone until asked"
        );
    }

    #[test]
    fn what_was_asked_and_finished_survives_a_restart() {
        let dir = scratch("restart");
        let (setup, _wakes) = Setup::load(&dir);
        setup.mark_asked(Permission::ThingsData);
        setup.finish_onboarding();
        let (again, _wakes) = Setup::load(&dir);
        assert!(again.onboarded(), "onboarding stays finished");
        assert!(again.asked(Permission::ThingsData), "Things stays asked");
        assert!(
            !again.asked(Permission::Keychain),
            "the Keychain was never asked"
        );
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn a_damaged_setup_file_reads_as_a_fresh_mac() {
        let dir = scratch("damaged");
        fs::create_dir_all(&dir).expect("the scratch folder");
        fs::write(dir.join("setup.json"), b"{not json").expect("a damaged file");
        let (setup, _wakes) = Setup::load(&dir);
        assert!(!setup.onboarded(), "a damaged file is ignored");
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn a_loop_reports_how_its_last_run_ended() {
        let (setup, wakes) = Setup::load(&scratch("runs"));
        assert_eq!(setup.things.last(), None, "no run yet");
        setup.things.record(Err("no network".to_owned()));
        let run = setup.things.last().expect("a recorded run");
        assert_eq!(run.error.as_deref(), Some("no network"), "the failure");
        setup.things.wake();
        assert!(wakes.things.try_recv().is_ok(), "a wake reaches the loop");
    }
}
