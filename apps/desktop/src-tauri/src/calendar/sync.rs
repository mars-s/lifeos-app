//! Sends Apple Calendar to `LifeOS` while the Mac app is open: on launch, on every calendar change, and every five minutes.
//!
//! It never asks for calendar access itself. Onboarding and Settings do, then wake it.

use std::{
    sync::{Arc, mpsc::Receiver},
    thread,
    time::{Duration, Instant},
};

use serde_json::Value;

use super::{
    eventkit::{self, Access, Store},
    snapshot::{Snapshot, Window},
};
use crate::{
    convex::{self, CONVEX_URL, Function},
    setup::{Setup, now_ms},
};

/// Gives the window time to draw before the first read competes with it.
const FIRST_RUN_AFTER: Duration = Duration::from_secs(5);
const RUN_EVERY: Duration = Duration::from_secs(5 * 60);
/// A burst of changes (a calendar account syncing) settles into one send.
const SETTLE: Duration = Duration::from_secs(2);
/// An unchanged window is sent again after this long, so `LifeOS` can tell the Mac is still connected.
const RESEND_UNCHANGED_AFTER: Duration = Duration::from_secs(60 * 60);

#[derive(Debug)]
enum Outcome {
    Sent(Value),
    Unchanged,
    Failed(String),
}

#[derive(Debug, Default)]
struct LastSent(Option<(Snapshot, Instant)>);

impl LastSent {
    fn is_fresh(&self, snapshot: &Snapshot) -> bool {
        self.0
            .as_ref()
            .is_some_and(|(sent, at)| sent == snapshot && at.elapsed() < RESEND_UNCHANGED_AFTER)
    }
}

pub(crate) fn start(setup: Arc<Setup>, woken: Receiver<()>) {
    let spawned = thread::Builder::new()
        .name("calendar-sync".into())
        .spawn(move || run(&setup, &woken));
    if let Err(error) = spawned {
        eprintln!("calendar sync: could not start: {error}");
    }
}

fn run(setup: &Setup, changes: &Receiver<()>) {
    thread::sleep(FIRST_RUN_AFTER);
    let _watch = eventkit::watch_changes(setup.calendar.waker());
    let mut store: Option<Store> = None;
    let mut last = LastSent::default();
    loop {
        if eventkit::access() == Access::Granted {
            let store = store.get_or_insert_with(Store::new);
            match sync_once(setup, store, &mut last) {
                Outcome::Sent(report) => {
                    eprintln!("calendar sync: sent {report}");
                    setup.calendar.record(Ok(()));
                }
                Outcome::Unchanged => setup.calendar.record(Ok(())),
                Outcome::Failed(reason) => {
                    eprintln!("calendar sync: failed, will retry: {reason}");
                    setup.calendar.record(Err(reason));
                }
            }
        } else {
            store = None;
        }
        wait_for_change(changes);
    }
}

fn sync_once(setup: &Setup, store: &Store, last: &mut LastSent) -> Outcome {
    let window = Window::around(now_ms());
    let (calendars, events) = store.read(window);
    let snapshot = Snapshot::new(window, calendars, events);
    if last.is_fresh(&snapshot) {
        return Outcome::Unchanged;
    }
    let sent = setup.token().and_then(|token| {
        convex::call::<Value>(
            CONVEX_URL,
            Function::Mutation,
            &snapshot.request_body(&token),
            &token,
        )
    });
    match sent {
        Ok(mut report) if report["ok"] == Value::Bool(true) => {
            last.0 = Some((snapshot, Instant::now()));
            Outcome::Sent(report["value"].take())
        }
        Ok(refused) => Outcome::Failed(format!("LifeOS refused the window: {refused}")),
        Err(reason) => Outcome::Failed(reason),
    }
}

fn wait_for_change(changes: &Receiver<()>) {
    if changes.recv_timeout(RUN_EVERY).is_ok() {
        thread::sleep(SETTLE);
        while changes.try_recv().is_ok() {}
    }
}
