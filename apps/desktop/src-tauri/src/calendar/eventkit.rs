//! Reads Apple Calendar through `EventKit`. macOS asks once whether `LifeOS` may see the calendars.

use std::{ptr::NonNull, sync::mpsc::Sender};

use block2::RcBlock;
use objc2::{
    rc::Retained,
    runtime::{Bool, ProtocolObject},
};
use objc2_app_kit::NSColorSpace;
use objc2_event_kit::{
    EKAuthorizationStatus, EKCalendar, EKCalendarType, EKEntityType, EKEvent, EKEventAvailability,
    EKEventStatus, EKEventStore, EKEventStoreChangedNotification, EKParticipantStatus,
};
use objc2_foundation::{NSDate, NSError, NSNotification, NSNotificationCenter, NSObjectProtocol};

use super::snapshot::{
    Availability, Calendar, CalendarKind, Colour, Event, Response, Status, Window,
};

const GREY: f64 = 0.5;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Access {
    Granted,
    Undecided,
    Refused,
}

pub(crate) fn access() -> Access {
    // SAFETY: a class method that only reads this process's calendar permission.
    let status = unsafe { EKEventStore::authorizationStatusForEntityType(EKEntityType::Event) };
    match status {
        EKAuthorizationStatus::FullAccess => Access::Granted,
        EKAuthorizationStatus::NotDetermined => Access::Undecided,
        _ => Access::Refused,
    }
}

/// Asks macOS for full calendar access, which shows the permission prompt once, and waits for the answer.
pub(crate) fn request_access() -> Access {
    let (sender, answer) = std::sync::mpsc::channel();
    let completion: RcBlock<dyn Fn(Bool, *mut NSError)> =
        RcBlock::new(move |granted: Bool, _error: *mut NSError| {
            sender.send(granted.as_bool()).ok();
        });
    let store = Store::new();
    // SAFETY: the block is retained by `completion` for the call, and EventKit copies it before returning.
    unsafe {
        store
            .0
            .requestFullAccessToEventsWithCompletion(RcBlock::as_ptr(&completion));
    }
    match answer.recv() {
        Ok(true) => Access::Granted,
        Ok(false) | Err(_) => Access::Refused,
    }
}

#[derive(Debug)]
pub(crate) struct Store(Retained<EKEventStore>);

impl Store {
    pub(crate) fn new() -> Self {
        // SAFETY: creates a fresh, owned event store.
        Self(unsafe { EKEventStore::new() })
    }

    /// Every event calendar, and every event occurrence that overlaps the window.
    pub(crate) fn read(&self, window: Window) -> (Vec<Calendar>, Vec<Event>) {
        // SAFETY: reads the store's event calendars.
        let calendars = unsafe { self.0.calendarsForEntityType(EKEntityType::Event) };
        let start = date_at(window.start);
        let end = date_at(window.end);
        // SAFETY: both dates are valid, and no calendar list means every calendar.
        let predicate = unsafe {
            self.0
                .predicateForEventsWithStartDate_endDate_calendars(&start, &end, None)
        };
        // SAFETY: the predicate was made by this store.
        let events = unsafe { self.0.eventsMatchingPredicate(&predicate) };
        (
            calendars.iter().map(|each| calendar(&each)).collect(),
            events.iter().filter_map(|each| event(&each)).collect(),
        )
    }
}

/// Keeps a calendar change observer registered until it is dropped.
#[derive(Debug)]
pub(crate) struct ChangeWatch(Retained<ProtocolObject<dyn NSObjectProtocol>>);

impl Drop for ChangeWatch {
    fn drop(&mut self) {
        // SAFETY: the observer was returned by `addObserverForName` on the same centre.
        unsafe { NSNotificationCenter::defaultCenter().removeObserver(self.0.as_ref()) };
    }
}

/// Sends a unit on `changed` whenever any calendar changes, on this Mac or by a sync.
pub(crate) fn watch_changes(changed: Sender<()>) -> ChangeWatch {
    let block: RcBlock<dyn Fn(NonNull<NSNotification>)> = RcBlock::new(move |_| {
        changed.send(()).ok();
    });
    // SAFETY: EventKit defines this notification name for the life of the process.
    let name = unsafe { EKEventStoreChangedNotification };
    // SAFETY: a valid name, no sender or queue filter, and the centre copies the block.
    let observer = unsafe {
        NSNotificationCenter::defaultCenter().addObserverForName_object_queue_usingBlock(
            Some(name),
            None,
            None,
            &block,
        )
    };
    ChangeWatch(observer)
}

fn calendar(calendar: &EKCalendar) -> Calendar {
    // SAFETY: reads a property of a calendar the store returned.
    let calendar_id = unsafe { calendar.calendarIdentifier() }.to_string();
    // SAFETY: as above.
    let title = unsafe { calendar.title() }.to_string();
    // SAFETY: as above.
    let source = unsafe { calendar.source() };
    let source = source.map_or_else(String::new, |source| {
        // SAFETY: reads the title of the calendar's account.
        unsafe { source.title() }.to_string()
    });
    // SAFETY: reads a property of a calendar the store returned.
    let kind = match unsafe { calendar.r#type() } {
        EKCalendarType::CalDAV => CalendarKind::CalDav,
        EKCalendarType::Exchange => CalendarKind::Exchange,
        EKCalendarType::Subscription => CalendarKind::Subscription,
        EKCalendarType::Birthday => CalendarKind::Birthday,
        _ => CalendarKind::Local,
    };
    // SAFETY: as above.
    let colour = unsafe { calendar.color() };
    let srgb = colour.colorUsingColorSpace(&NSColorSpace::sRGBColorSpace());
    Calendar {
        id: calendar_id,
        title,
        colour: srgb.map_or(
            Colour {
                red: GREY,
                green: GREY,
                blue: GREY,
            },
            |srgb| Colour {
                red: srgb.redComponent(),
                green: srgb.greenComponent(),
                blue: srgb.blueComponent(),
            },
        ),
        source,
        kind,
    }
}

fn event(event: &EKEvent) -> Option<Event> {
    // SAFETY: reads a property of an event the store returned.
    let calendar = unsafe { event.calendar() }?;
    // SAFETY: reads a property of the event's calendar.
    let calendar_id = unsafe { calendar.calendarIdentifier() }.to_string();
    // SAFETY: reads a property of an event the store returned.
    let id = unsafe { event.eventIdentifier() }.map(|id| id.to_string());
    // SAFETY: as above.
    let item_id = unsafe { event.calendarItemIdentifier() }.to_string();
    // SAFETY: as above.
    let title = unsafe { event.title() }.to_string();
    // SAFETY: as above.
    let start = unsafe { event.startDate() };
    // SAFETY: as above.
    let end = unsafe { event.endDate() };
    // SAFETY: as above.
    let all_day = unsafe { event.isAllDay() };
    // SAFETY: as above.
    let occurrence = unsafe { event.occurrenceDate() };
    // SAFETY: as above.
    let recurring = unsafe { event.hasRecurrenceRules() } || {
        // SAFETY: as above.
        unsafe { event.isDetached() }
    };
    // SAFETY: as above.
    let location = unsafe { event.location() }.map(|location| location.to_string());
    // SAFETY: as above.
    let availability = match unsafe { event.availability() } {
        EKEventAvailability::Busy => Availability::Busy,
        EKEventAvailability::Free => Availability::Free,
        EKEventAvailability::Tentative => Availability::Tentative,
        EKEventAvailability::Unavailable => Availability::Unavailable,
        _ => Availability::Unknown,
    };
    // SAFETY: as above.
    let status = match unsafe { event.status() } {
        EKEventStatus::Canceled => Status::Canceled,
        _ => Status::Scheduled,
    };
    Some(Event {
        id,
        item_id,
        calendar_id,
        title,
        start_ms: millis(&start),
        end_ms: millis(&end),
        all_day,
        occurrence_ms: occurrence.as_deref().map(millis),
        recurring,
        location,
        availability,
        status,
        response: my_response(event),
    })
}

/// Avi's own reply to an invitation. Nothing else about the attendees is read.
fn my_response(event: &EKEvent) -> Option<Response> {
    // SAFETY: reads a property of an event the store returned.
    let attendees = unsafe { event.attendees() }?;
    let me = attendees.iter().find(|attendee| {
        // SAFETY: reads a property of an attendee of that event.
        unsafe { attendee.isCurrentUser() }
    })?;
    // SAFETY: as above.
    match unsafe { me.participantStatus() } {
        EKParticipantStatus::Accepted => Some(Response::Accepted),
        EKParticipantStatus::Declined => Some(Response::Declined),
        EKParticipantStatus::Tentative => Some(Response::Tentative),
        EKParticipantStatus::Pending => Some(Response::Pending),
        _ => None,
    }
}

#[expect(
    clippy::as_conversions,
    clippy::cast_precision_loss,
    reason = "epoch milliseconds stay far below 2^53, so an f64 holds them exactly"
)]
fn date_at(ms: i64) -> Retained<NSDate> {
    NSDate::dateWithTimeIntervalSince1970(ms as f64 / 1000.0)
}

#[expect(
    clippy::as_conversions,
    clippy::cast_possible_truncation,
    reason = "a calendar date in milliseconds fits an i64 with room to spare"
)]
fn millis(date: &NSDate) -> i64 {
    (date.timeIntervalSince1970() * 1000.0).round() as i64
}
