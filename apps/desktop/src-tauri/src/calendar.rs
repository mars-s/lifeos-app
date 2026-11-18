//! Mirrors Apple Calendar into `LifeOS` as External Commitments. Read only: nothing is written to Calendar.

#[cfg(target_os = "macos")]
mod eventkit;
mod snapshot;
#[cfg(target_os = "macos")]
mod sync;

#[cfg(target_os = "macos")]
pub(crate) use sync::start;
