//! The window of Apple Calendar that the Mac app sends to `LifeOS`, and how events map into it.

use serde::Serialize;
use serde_json::{Value, json};

use crate::convex::Token;

const SYNC_PATH: &str = "calendar/sync:applyWindow";
const DAY_MS: i64 = 86_400_000;
/// How far back the window reaches, so a commitment moved into the past week still updates.
const DAYS_BACK: i64 = 7;
/// How far ahead the window reaches. The Planner and the Timebox calendar look at most nine weeks out.
const DAYS_AHEAD: i64 = 61;
const UNTITLED: &str = "Busy";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Window {
    pub(crate) start: i64,
    pub(crate) end: i64,
}

impl Window {
    /// The window around a moment, aligned to whole UTC days so the snapshot stays the same all day.
    pub(crate) fn around(now_ms: i64) -> Self {
        let today = now_ms.div_euclid(DAY_MS) * DAY_MS;
        Self {
            start: today - DAYS_BACK * DAY_MS,
            end: today + DAYS_AHEAD * DAY_MS,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub(crate) enum CalendarKind {
    #[serde(rename = "local")]
    Local,
    #[serde(rename = "calDAV")]
    CalDav,
    #[serde(rename = "exchange")]
    Exchange,
    #[serde(rename = "subscription")]
    Subscription,
    #[serde(rename = "birthday")]
    Birthday,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub(crate) struct Colour {
    pub(crate) red: f64,
    pub(crate) green: f64,
    pub(crate) blue: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Calendar {
    #[serde(rename = "calendarId")]
    pub(crate) id: String,
    pub(crate) title: String,
    pub(crate) colour: Colour,
    pub(crate) source: String,
    pub(crate) kind: CalendarKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Availability {
    Busy,
    Free,
    Tentative,
    Unavailable,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Response {
    Accepted,
    Declined,
    Tentative,
    Pending,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Status {
    Scheduled,
    Canceled,
}

/// One event occurrence as `EventKit` describes it, before it becomes an External Commitment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Event {
    pub(crate) id: Option<String>,
    pub(crate) item_id: String,
    pub(crate) calendar_id: String,
    pub(crate) title: String,
    pub(crate) start_ms: i64,
    pub(crate) end_ms: i64,
    pub(crate) all_day: bool,
    pub(crate) occurrence_ms: Option<i64>,
    pub(crate) recurring: bool,
    pub(crate) location: Option<String>,
    pub(crate) availability: Availability,
    pub(crate) status: Status,
    pub(crate) response: Option<Response>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Commitment {
    calendar_id: String,
    event_key: String,
    title: String,
    start: i64,
    end: i64,
    all_day: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    location: Option<String>,
    availability: Availability,
    #[serde(skip_serializing_if = "Option::is_none")]
    response: Option<Response>,
    recurring: bool,
}

impl Commitment {
    /// Maps one occurrence. A canceled event uses no time, so it has no commitment.
    pub(crate) fn from_event(event: Event) -> Option<Self> {
        if event.status == Status::Canceled {
            return None;
        }
        let id = event.id.unwrap_or(event.item_id);
        let event_key = if event.recurring {
            format!("{id}@{}", event.occurrence_ms.unwrap_or(event.start_ms))
        } else {
            id
        };
        let title = event.title.trim();
        Some(Self {
            calendar_id: event.calendar_id,
            event_key,
            title: if title.is_empty() { UNTITLED } else { title }.to_owned(),
            start: event.start_ms,
            end: event.end_ms.max(event.start_ms),
            all_day: event.all_day,
            location: event
                .location
                .map(|location| location.trim().to_owned())
                .filter(|location| !location.is_empty()),
            availability: event.availability,
            response: event.response,
            recurring: event.recurring,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub(crate) struct Snapshot {
    pub(crate) window: Window,
    pub(crate) calendars: Vec<Calendar>,
    pub(crate) commitments: Vec<Commitment>,
}

impl Snapshot {
    pub(crate) fn new(window: Window, calendars: Vec<Calendar>, events: Vec<Event>) -> Self {
        let mut commitments: Vec<Commitment> = events
            .into_iter()
            .filter_map(Commitment::from_event)
            .collect();
        commitments.sort_by(|a, b| (a.start, &a.event_key).cmp(&(b.start, &b.event_key)));
        Self {
            window,
            calendars,
            commitments,
        }
    }

    pub(crate) fn request_body(&self, token: &Token) -> Value {
        json!({
            "path": SYNC_PATH,
            "args": {
                "token": token.secret(),
                "window": self.window,
                "calendars": self.calendars,
                "commitments": self.commitments,
            },
            "format": "json",
        })
    }
}

#[cfg(test)]
mod tests {
    use std::env;

    use serde_json::{Value, json};

    use super::{
        Availability, Calendar, CalendarKind, Colour, Commitment, Event, Response, Snapshot,
        Status, Window,
    };
    use crate::convex::{self, Function, Token};

    const FIXTURE: &str = include_str!("../../fixtures/calendar-window.json");
    const NOV_19_NOON_UTC: i64 = 1_795_089_600_000;
    const HOUR: i64 = 3_600_000;

    fn sydney(day: i64, hour: i64, minute: i64) -> i64 {
        let nov_1_midnight_sydney = 1_793_451_600_000;
        nov_1_midnight_sydney + (day - 1) * 24 * HOUR + hour * HOUR + minute * 60_000
    }

    fn event(id: &str, calendar: &str, title: &str, start: i64, end: i64) -> Event {
        Event {
            id: Some(id.to_owned()),
            item_id: format!("item-{id}"),
            calendar_id: calendar.to_owned(),
            title: title.to_owned(),
            start_ms: start,
            end_ms: end,
            all_day: false,
            occurrence_ms: None,
            recurring: false,
            location: None,
            availability: Availability::Busy,
            status: Status::Scheduled,
            response: None,
        }
    }

    fn standup(day: i64) -> Event {
        let start = sydney(day, 9, 30);
        Event {
            recurring: true,
            occurrence_ms: Some(start),
            response: Some(Response::Accepted),
            ..event("EV-STANDUP", "CAL-WORK", "Standup", start, start + HOUR / 4)
        }
    }

    fn fixture_calendars() -> Vec<Calendar> {
        let calendar = |id: &str, title: &str, colour: [f64; 3], source: &str, kind| Calendar {
            id: id.to_owned(),
            title: title.to_owned(),
            colour: Colour {
                red: colour[0],
                green: colour[1],
                blue: colour[2],
            },
            source: source.to_owned(),
            kind,
        };
        vec![
            calendar(
                "CAL-WORK",
                "Work",
                [0.2, 0.6, 0.9],
                "iCloud",
                CalendarKind::CalDav,
            ),
            calendar(
                "CAL-HOME",
                "Home",
                [0.95, 0.75, 0.1],
                "On My Mac",
                CalendarKind::Local,
            ),
            calendar(
                "CAL-HOLIDAYS",
                "Australian Holidays",
                [0.4, 0.8, 0.3],
                "Other",
                CalendarKind::Subscription,
            ),
        ]
    }

    fn fixture_events() -> Vec<Event> {
        vec![
            Event {
                all_day: true,
                availability: Availability::Unknown,
                ..event(
                    "EV-HOLIDAY",
                    "CAL-HOLIDAYS",
                    "Bank holiday",
                    sydney(37, 0, 0),
                    sydney(38, 0, 0),
                )
            },
            standup(23),
            Event {
                location: Some(" Surry Hills ".to_owned()),
                ..event(
                    "EV-DENTIST",
                    "CAL-HOME",
                    "Dentist",
                    sydney(20, 11, 0),
                    sydney(20, 12, 0),
                )
            },
            standup(20),
            Event {
                availability: Availability::Free,
                location: Some(String::new()),
                ..event(
                    "EV-LUNCH",
                    "CAL-HOME",
                    "Lunch with Sam",
                    sydney(20, 12, 30),
                    sydney(20, 13, 30),
                )
            },
            Event {
                response: Some(Response::Declined),
                ..event(
                    "EV-REVIEW",
                    "CAL-WORK",
                    "Design review",
                    sydney(20, 15, 0),
                    sydney(20, 16, 0),
                )
            },
            event(
                "EV-DINNER",
                "CAL-HOME",
                "Dinner at Mum's",
                sydney(20, 19, 0),
                sydney(20, 21, 0),
            ),
            Event {
                all_day: true,
                availability: Availability::Free,
                ..event(
                    "EV-OFFSITE",
                    "CAL-WORK",
                    "Team offsite",
                    sydney(24, 0, 0),
                    sydney(25, 0, 0),
                )
            },
            Event {
                status: Status::Canceled,
                ..event(
                    "EV-CANCELED",
                    "CAL-WORK",
                    "Cancelled 1:1",
                    sydney(21, 10, 0),
                    sydney(21, 11, 0),
                )
            },
        ]
    }

    #[test]
    fn the_snapshot_matches_the_window_the_backend_tests_accept() {
        let snapshot = Snapshot::new(
            Window::around(NOV_19_NOON_UTC),
            fixture_calendars(),
            fixture_events(),
        );
        let fixture: Value = serde_json::from_str(FIXTURE).expect("the fixture is JSON");
        let sent = snapshot.request_body(&Token::new("secret".into()));
        assert_eq!(sent["path"], json!("calendar/sync:applyWindow"), "the path");
        assert_eq!(sent["args"]["token"], json!("secret"), "the token");
        for part in ["window", "calendars", "commitments"] {
            assert_eq!(sent["args"][part], fixture[part], "{part}");
        }
    }

    #[test]
    fn each_occurrence_of_a_recurring_event_has_its_own_key() {
        let first = Commitment::from_event(standup(20)).expect("a commitment");
        let second = Commitment::from_event(standup(23)).expect("a commitment");
        assert_ne!(first.event_key, second.event_key, "two occurrences");
        assert!(
            first.event_key.starts_with("EV-STANDUP@"),
            "{}",
            first.event_key
        );
    }

    #[test]
    fn a_moved_occurrence_keeps_the_key_of_its_original_date() {
        let original = standup(20);
        let moved = Event {
            start_ms: original.start_ms + 2 * HOUR,
            end_ms: original.end_ms + 2 * HOUR,
            ..original.clone()
        };
        assert_eq!(
            Commitment::from_event(moved).map(|c| c.event_key),
            Commitment::from_event(original).map(|c| c.event_key),
            "the occurrence date names it"
        );
    }

    #[test]
    fn an_event_without_an_event_identifier_uses_its_item_identifier() {
        let commitment = Commitment::from_event(Event {
            id: None,
            ..event("X", "CAL", "Gym", 0, HOUR)
        })
        .expect("a commitment");
        assert_eq!(commitment.event_key, "item-X", "the fallback key");
    }

    #[test]
    fn an_untitled_event_reads_as_busy_and_an_end_before_its_start_is_clamped() {
        let commitment =
            Commitment::from_event(event("X", "CAL", "  ", HOUR, 0)).expect("a commitment");
        assert_eq!(commitment.title, "Busy", "the title");
        assert_eq!(commitment.end, commitment.start, "the end");
    }

    #[test]
    fn the_window_runs_a_week_back_and_nine_weeks_ahead_on_whole_days() {
        let window = Window::around(NOV_19_NOON_UTC);
        let midnight = NOV_19_NOON_UTC - 12 * HOUR;
        assert_eq!(
            window,
            Window {
                start: midnight - 7 * 24 * HOUR,
                end: midnight + 61 * 24 * HOUR,
            },
            "the window"
        );
        assert_eq!(Window::around(midnight + 1), window, "the same all day");
    }

    #[test]
    #[ignore = "sends the fixture window to the Convex backend named by LIFEOS_TEST_CONVEX_URL"]
    fn sends_the_fixture_window_to_a_running_backend() {
        let url = env::var("LIFEOS_TEST_CONVEX_URL").expect("LIFEOS_TEST_CONVEX_URL is set");
        let token = convex::read_token().expect("LIFEOS_THINGS_SYNC_TOKEN names a test Worker");
        let snapshot = Snapshot::new(
            Window::around(NOV_19_NOON_UTC),
            fixture_calendars(),
            fixture_events(),
        );
        let first: Value = convex::call(
            &url,
            Function::Mutation,
            &snapshot.request_body(&token),
            &token,
        )
        .expect("the backend answers");
        let again: Value = convex::call(
            &url,
            Function::Mutation,
            &snapshot.request_body(&token),
            &token,
        )
        .expect("the backend answers again");
        println!("first: {first}\nagain: {again}");
        assert_eq!(first["ok"], json!(true), "accepted: {first}");
        assert_eq!(
            again["value"]["commitments"]["unchanged"].as_f64(),
            Some(8.0),
            "unchanged the second time: {again}"
        );
    }
}
