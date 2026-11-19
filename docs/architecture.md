# LifeOS architecture: core, modules and workers

Decided with Avi on 18 November 2026. LifeOS is a whole life OS, not only a planner. Tasks and planning come first, then notes, saved links and in-app agents. This page fixes the shape every module plugs into, so later modules do not force a rewrite.

## The three places things run

| Place | What it is | What runs there |
| --- | --- | --- |
| **Core** | Hosted Convex (free tier), reachable from anywhere | The live app data: Tasks, Areas, Projects, planning, Activity, the Job queue, and searchable indexes of notes and saved links. Every client and the MCP connector talk to it. |
| **Home Server** | One thin LXC container on Avi's Proxmox box, on his Tailscale network, with the 2 TB SSD | Always-on Workers: in-app agents using Avi's Claude and ChatGPT subscriptions (Claude Code and Codex logged in inside the container), link indexing (a small embedding model, plus the OpenAI API for classification), the always-on Notes peer and archive, and large files. Keep it thin: Node, the two agent CLIs, Tailscale, nothing else. |
| **Mac app** | Tauri on Avi's MacBook | The Things Worker until Switch Day (it imports from a copy of the Things database every few minutes, one way), the Apple Calendar reader (EventKit, read only), trackpad haptics, a Notes peer, and a fallback agent runner when the Home Server is down. |

Clients (web, Mac, iPhone) read and write Core. They never depend on the Home Server being up, except for notes edited on another device, which merge when the peers meet.

## Workers and Jobs: one pattern for all background work

Anything that must happen outside Convex is a **Job** in Core, claimed by a **Worker**:

- A Job has a kind, a payload, an idempotency key, a status (queued, claimed, done, failed), a lease with a heartbeat, an attempt count, and a result or receipt.
- A Worker registers what it can do (for example `things`, `agent:claude`, `agent:codex`, `index:link`), subscribes to queued Jobs it can handle, claims one with a lease, heartbeats while working, and reports a result. An expired lease returns the Job to the queue.
- Agent runs, link indexing and note archiving are all Job kinds. There is one queue, one claim rule and one retry rule, so a new module adds a Job kind, not a new queue.
- The Mac Worker claims no Jobs. Its `things` capability lets it send Things Imports until Switch Day (`docs/leaving-things.md`). Nothing in LifeOS writes to Things. Its `calendar` capability lets it send Apple Calendar windows (below).

## Apple Calendar: read on the Mac, mirrored in Core

EventKit only runs on Apple devices, so the Mac app reads Apple Calendar and Core keeps a mirror. Every client reads the mirror, so the web and iPhone apps see the same External Commitments without asking for calendar access.

- The reader lives in `apps/desktop/src-tauri/src/calendar/`. `eventkit.rs` reads every event calendar, and reads each event occurrence in a window from 7 days back to 61 days ahead. `snapshot.rs` maps them into the shape Core accepts. `sync.rs` sends the window about five seconds after launch, two seconds after any calendar change (`EKEventStoreChangedNotification`), and every five minutes. An unchanged window is sent at most once an hour.
- It reads title, times, all-day, location, availability, whether it repeats, and Avi's own reply to an invitation. It never reads notes, URLs or other attendees.
- It signs in with the same Keychain token as the Things Import (`lifeos-app-things-sync`). Core accepts the window from a Worker with the `calendar` capability (`calendar/sync:applyWindow`), which upserts by occurrence and deletes what vanished inside the window (`docs/data-model.md`).
- The Mac app never prompts at launch. Onboarding asks for calendar access, the Things data and the Keychain token once each, and Settings can ask again (`permissions.rs`, `setup.rs`). Until a permission has been asked for, the loop that needs it waits. The calendar prompt text is in `Info.plist`.
- Nothing is written to Apple Calendar. Writing Work Blocks back is the next step of #5.
- Workers authenticate with a scoped machine token per Worker, stored in that machine's keychain or secret store. Convex keeps only its hash.
- People authenticate with GitHub through Convex Auth, and only the owner's account gets in. Every public function goes through the owner guard (`docs/auth.md`).

## Agents

- **Runners**: agents run in a Worker on the Home Server, using Claude Code or Codex with Avi's subscriptions. The Mac app can run them too. A cloud runner (Vercel Eve or similar, paid per API call through an AI gateway) can be added later as another Worker, with no change to Core.
- **Power**: agents act on their own and every change can be undone. An agent changes data through the same mutations as the UI, with the actor recorded as that agent run. Activity keeps the inverse of every change, so a whole run can be undone in one step.
- **Generative UI**: agents answer with structured results rendered by our own components. The AffectUI library in `docs/design/references/affectui/` is the inspiration.

## Modules

A module is one area of the life OS: Planner (Tasks, Areas, Projects), Calendar, Notes, Saved Links, Agents, and later Health or a Journal. Each module owns:

- its tables in the one Convex schema, in its own folder under the backend, with names prefixed only where they would clash,
- its view queries and mutations,
- its MCP tools for agents,
- its Job kinds and Worker handlers,
- its screens and a sidebar entry on each client.

Modules share these primitives instead of reinventing them:

- **Areas** span modules: a note or saved link can belong to an Area just like a Task.
- **Entity references**: one typed reference shape (Task, Project, Area, Note, Saved Link, Work Block, External Commitment) so anything can link to anything, with backlinks.
- **Activity**: every change in every module, with actor and inverse, for undo, history and visualisations.
- **Labels** and **search**: one search that every module feeds.
- **Jobs**: the queue above.

Modules live in the main Convex app, not as Convex components. Components isolate tables, which would block cross-module links, shared Activity and one search. Components stay for third-party pieces such as the MCP server.

## Features

Decided with Avi on 19 November 2026 (#51). A Module is an area of the life OS that is always there. A **Feature** is an optional capability Avi switches on, such as Smart Estimates or Places (#52). It has its own settings page and its own needs, and it plugs into surfaces that already exist instead of adding a screen. Settings is the host every Feature plugs into.

### One registry, declared once

`packages/backend/shared/features.ts` (`@lifeos/backend/features`) declares every Feature in one typed table. The backend and every app read the same entry, so nothing about a Feature is written twice.

| Field | What it says |
| --- | --- |
| `title`, `summary`, `icon` | The row in Settings and the command bar. `icon` is a name; each app maps it to its own icon set |
| `enabledByDefault` | Whether the Feature is on before Avi touches it |
| `secrets` | The named keys it needs (`openai`), saved through the sealed secrets store |
| `settings`, `defaultSettings` | A Convex validator for its settings, and the values before Avi changes any |
| `setup` | What Avi must enter before it can work, such as `home` for Places |
| `uses` | Other Features it works better with. Optional: it still works without them |

Adding a Feature means one registry entry, its settings validator, its status check, and its settings page. The table, the status line, the Settings row, the nested route and the command bar entry all follow from the entry.

### Storage and status

- The `features` table holds one row per Feature Avi has changed: `{ feature, enabled, settings }`, a union with one member per Feature, so its settings are validated by the Feature's own validator. A missing row means the registry defaults.
- `platform/features:list` returns each Feature's effective state and its **Feature Status**: `off`, `needs_key` (a secret it needs is missing), `needs_setup` (such as no Home address yet), or `ready`. A Feature only does work when it is `ready`.
- Switching a Feature and changing its settings are `changeMutation`s, so they land in Activity and can be undone. Secrets and Saved Places stay out of Activity: secrets because they are keys, Saved Places because a home address should not sit in history. Both ask Avi to confirm before they are removed.
- `uses` is the only way one Feature reaches another. `featureUses(ctx, "smartEstimates", "places")` type-checks against the registry and answers whether Places is ready, so Smart Estimates never hard-codes a check on another Feature's tables.

### Settings as the host

- Settings lists every Feature from the registry as one row: icon, title, its status in words, a switch, and a chevron.
- The row opens `/settings/features/<id>`, a real route. Back returns to Settings. The Mac app serves it from the static bundle (each id is a prerendered path), and the command bar can jump straight to it.
- Each app keeps one map from Feature id to its settings page. The page shows the switch, the keys the registry says it needs, and the Feature's own settings.

### Places

- **Saved Places.** Avi enters Home (and optionally Work or Uni). `places/saved:save` geocodes it once with OpenStreetMap Nominatim and stores the coordinates. Saving the same address again reuses the stored coordinates, so Nominatim is asked at most once per address.
- **Detecting a Trip.** On a new or renamed Task, and when its card opens, Places asks the Decisions API two questions in one call: a predicate (does this Task need a trip to a physical place?) and a choice over the place phrases found in the title, plus a few common kinds of place (post office, pharmacy). The Decisions API cannot return free text, so the choice offers phrases LifeOS cut from the title. It runs two seconds after the last edit, only when Places is `ready`, and is skipped when the inputs hash matches the last answer.
- **Finding the place.** Overpass finds every match within 15 km of Home, by brand or name, or by tag for a kind of place. The nearest five by straight-line distance are kept.
- **Travel time.** One OSRM `table` call on the FOSSGIS servers (`routing.openstreetmap.de`) gives travel time and road distance from Home to all five, for the Travel Mode (drive, walk or cycle). Public transport is not available on any free routing service, and the Places page says so.
- **Privacy.** The full address goes only to Nominatim, once per address. Overpass and routing get Home rounded to three decimal places (about 100 m). The Decisions API sees only the Task title. Everything stays owner-only in Core.
- **On the card.** A small mapcn map (MapLibre with OpenFreeMap tiles, in the calm light and dark styles) shows Home and the place, with its name, suburb, distance, travel time and Open in Maps. Avi can pick another of the five branches or dismiss the Trip. Both are `changeMutation`s and can be undone.

### Features working together

Smart Estimates `uses` Places. When Places is ready, the Decisions API is told travel is added separately, and the Smart Estimate shown on the card adds the chosen Trip there and back to its pick at read time: "0:10 in store plus 0:24 there and back". Picking another branch or dismissing the Trip changes the Smart Estimate at once, with no new call to OpenAI.

## Notes: local-first

Notes are local-first, like Anytype. The Mac, the iPhone and the Home Server each keep a full copy and can edit offline. Edits merge automatically with a CRDT (Loro, Automerge or Yjs; choose in a dedicated spike). The Home Server is the always-on peer and the archive on the 2 TB SSD. Peers sync directly over Tailscale, and Core can relay changes between peers that cannot reach each other.

Core keeps only a searchable projection of each note (title, Area, entity references, a short excerpt and an embedding) so Tasks, search and agents can link to notes without holding the documents.

## Saved Links

Pocket or mymind style. Capturing a URL creates a Saved Link in Core at once. An `index:link` Job on the Home Server fetches the page, extracts the text, embeds it with a small local model, classifies it (the OpenAI API is allowed for this) and stores the full content and screenshots on the SSD. Core keeps the title, summary, labels, Area and embedding for search.

## What this means now

The data model slice builds the shared primitives (Activity with actor and inverse, entity references, Jobs and Workers, module folders) even though only the Planner uses them at first. Notes, Saved Links and agents arrive as modules later without schema rewrites.
