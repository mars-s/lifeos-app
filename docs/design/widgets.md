# Widgets design

The design for LifeOS widgets on iPhone and Mac, and how they are built (see Built). The live specimen is the Waku route `/design/widgets` in `apps/web` (run `pnpm dev:web`, open `/design/widgets`). The Task boxes can be ticked, and the Home Screen and the Mac desktop have switches for their modes. The shared look is in [system.md](system.md). The plan is tracked in issue #84.

## Direction

1. **One figure each.** A widget answers one question with one number you can read from across the room.
2. **Drawn like a gauge.** A title, a one-word state, a dot-matrix figure, a unit, and an analog strip at the foot. The same parts at every size.
3. **Still until a clock runs.** Nothing moves on the Home Screen. Only a Focus Session counts down, and only a Task's box can be pressed.

The style comes from [the health tiles Avi picked](references/widgets/01-health-stat-tiles.png): a big dot-matrix number, a small title over a one-word state, a tiny unit badge, and a thin strip with a time axis. From LifeOS it takes warm paper and graphite, Geist Mono for every time and count, the Planner's rule that one dot is 15 minutes, Area colours as dots, and amber for a Deadline only. There is no blue, no gradient and no decoration.

## The tile

Shot: `widgets-anatomy.png`.

| Part | Rule |
| --- | --- |
| Title and state | 15 px medium over 11 px muted. The state is one word (roomy, steady, tight, full, over) or the thing itself (the Task title, the date) |
| Figure | Dots on a 5 by 7 grid, pitch 5.5 pt on a small tile. Times are always h:mm, like an Estimate. At most four glyphs on a small tile |
| Unit badge | A filled glyph over the unit (h:m, min, left, days), on a step of tone |
| Strip | The analog reading of the same fact, 12 pt tall |
| Axis | Two Geist Mono labels at 10 px, one at each end. Never more than two |

Four strips cover every widget:

- **Day strip.** A tick each half hour, taller on the hour. A solid bar is a Work Block in its Area colour, an outlined bar is an External Commitment, a dashed line is a Trip, and the tall line is now. What is behind now fades.
- **Capacity dots.** One dot is 15 minutes, grouped by the hour, filled in Area colours. A dot past Capacity is a red ring.
- **Week columns.** A column per day. A dot is an hour (half an hour at extra large) planned, over the hours free. A diamond above a column is a Deadline.
- **Focus ticks.** One tick a minute of the Focus Session. The done ones stand tall.

Tile sizes used on the specimen: small 164, medium 344 by 164, large 344 by 360, extra large 704 by 360, corner radius 26, padding 14. Take the real sizes from WidgetKit.

## The set

Six ideas were weighed. Five became widgets, one became a control, one was dropped.

| Widget | Sizes | Figure | Strip | A tap opens |
| --- | --- | --- | --- | --- |
| Today | medium, large; Lock Screen circle and inline | Tasks left | Capacity dots (and the day strip at large) | Today. The box ticks the Task without opening the app |
| Capacity | small; Lock Screen circle; StandBy | Time left of today's Capacity | Day strip | The Planner on today |
| Next up | small, medium; Lock Screen rectangle | Time until the next Work Block | Day strip for the next two and a half hours | That Task |
| Focus | small; Live Activity; Dynamic Island; StandBy | Minutes left | Focus ticks | The timer |
| Upcoming | medium on iPhone; This week at extra large on Mac | Days to the next Deadline (hours still free at extra large) | Week columns | Upcoming |
| Brain Dump | Control Centre control; Lock Screen circle | Count to sort | none | Quick capture |

- **Today** at medium shows the next three Tasks, at large six, each with its Estimate and Area dot.
- **Next up** at medium adds the Area, the place, the drive and "Leave by 9:53 am". At small the axis carries the leave time and the place.
- **This week** (Mac, extra large) is a column per day with the planned time under it, the next three Deadlines, three Tasks and the Brain Dump count.
- **Dropped.** A Brain Dump tile on the Home Screen: a count of unsorted thoughts nags, and a control is one tap closer. A Daily note widget: it puts a line of private text on the Home Screen, and Notes is still settling.

## Shots

Taken by `apps/web/scripts/check-widgets-design.py` at 1440 px, and at 390 px for the two phone sections.

| Shot | What it shows |
| --- | --- |
| `widgets-home.png`, `-dark`, `widgets-home-tinted.png`, `widgets-home-clear.png` | The iPhone Home Screen in light, dark, tinted and clear |
| `widgets-desktop.png`, `-dark`, `widgets-desktop-front.png`, `-front-dark` | The Mac desktop, and the same with LifeOS in front |
| `widgets-lock-screen.png` | The Lock Screen with the accessories, the Dynamic Island and the Live Activity |
| `widgets-iphone.png`, `-dark` | Small, medium and large |
| `widgets-modes.png`, `-dark` | One set in light, dark, tinted and clear, side by side |
| `widgets-lock.png`, `-dark` | Accessories, Dynamic Island, StandBy (day and night), Control Centre |
| `widgets-mac.png`, `-dark` | The desktop and This week at extra large |
| `widgets-states.png`, `-dark` | The edge cases |
| `widgets-anatomy.png`, `-dark` | The parts, the 11 glyphs and the four strips |
| `widgets-iphone-phone.png`, `widgets-lock-phone.png`, `-dark` | The two phone sections at 390 px |

## Modes

Colour is never the only signal, because iOS and macOS often take it away.

| Mode | What happens |
| --- | --- |
| Light and dark | Paper or graphite tile. Area colours on dots and Work Blocks, amber on the Deadline diamond, red on a figure that is over |
| Tinted (iOS 18 and later) | Dark glass and one tint. The figure and filled shapes are `widgetAccentable`; the rest steps down in opacity |
| Clear (iOS 26) | Clear glass, white ink, same steps |
| Lock Screen | Vibrant, one ink, no tile. Circles sit on `AccessoryWidgetBackground` |
| StandBy | Background removed on black, drawn 1.5 times larger. Night mode is the same drawing in red |
| Mac, app in front | macOS fades desktop widgets to one ink. Same steps as tinted |

So an Area turns to ink but its name is still written, a Deadline keeps its diamond, an External Commitment keeps its outline, a Trip keeps its dashes, and over Capacity says "over" as its state.

## States

Shot: `widgets-states-dark.png`.

- **Clear.** Today shows 0 with the state "clear" and the day's dots faded.
- **Over.** Capacity shows how far over in red with the state "over".
- **Nothing booked.** Next up says "Free until tomorrow, 9 am" over the day strip.
- **Focus ready.** The Task and a Start button (an `AppIntent`). **Paused** dims the figure and says "paused".
- **Stale.** A snapshot from another day dims the figure, says "as of Fri" and "Open LifeOS to refresh".
- **Placeholder.** Bars and an unlit 8:88 before the first snapshot.

## What WidgetKit allows

- A widget is a timeline of snapshots. Nothing animates, so no strip depends on motion.
- The minute figures (Next up, Focus on the Home Screen) come from one timeline entry a minute, which costs no reload budget. The Live Activity and the Dynamic Island use `Text(timerInterval:)` for the live mm:ss and `ProgressView(timerInterval:)` under a tick-shaped mask for the strip.
- `Text(timerInterval:)` only takes a font, so the 11 glyphs (the digits and a colon) are built into a small font file as well as drawn as shapes. The grid is in `apps/web/src/components/design-board/widgets/model.ts`.
- Only Buttons and Toggles with an `AppIntent` can be pressed: the Task box, Start, Pause and Stop, and the two controls. Everything else is a `widgetURL` deep link.
- Custom fonts work in widgets. Geist Mono ships for figures. See the open question on Inter.

## Data

Widgets never talk to Convex to draw. Each app writes one snapshot file to its App Group and asks WidgetKit to reload.

- **Written when** the Day Plan, a Work Block, the Focus Session or the Brain Dump count changes, and when the app goes to the background.
- **Holds** the date and when it was written, Working Hours, Capacity and Day Load, today's Tasks (id, title, Area name and colour, Estimate), today's Work Blocks, External Commitments and Trips, the next Work Block with its place and leave time, the Focus Session (Task, start, planned length, paused), seven days of planned minutes by Area with Capacity and Deadlines, the next three Deadlines, and the Brain Dump count.
- **Ticking a Task** runs an `AppIntent` in the widget extension. It calls the same owner-guarded complete mutation with a token from the shared Keychain group, so the change records Activity and can be undone in the app. It then rewrites the snapshot and reloads. Offline, it marks the Task done in the snapshot and the app sends it later.
- **The Live Activity** is started and updated by the app through ActivityKit when a Focus Session starts, pauses or ends.

## Shipping

- **iPhone (Expo).** A WidgetKit target added with `expo-apple-targets` (`apps/mobile/targets/widgets`), written in SwiftUI, with the App Group and Keychain group in the app config. A small Expo module writes the snapshot and starts the Live Activity. Controls need iOS 18, tinted needs iOS 18, clear needs iOS 26.
- **Mac (Tauri).** A widget extension (`.appex`) built with Xcode and embedded in the app bundle under `Contents/PlugIns`, signed with the same team and App Group. The Rust side writes the snapshot and calls `WidgetCenter` through a small Swift bridge. iPhone widgets also show on the Mac through Continuity, so the Mac extension is only needed for the extra large size and for when the iPhone is away.
- **Shared.** One Swift package holds the parts, the strips, the glyph font and the snapshot type, used by both extensions.

## Decisions (28 Nov 2026)

1. Capacity counts down with the clock: free working time still ahead of now (less External Commitments), capped at the day's Capacity, less the open Day Load. It moves through timeline entries a minute apart, so it needs no app.
2. Words are in Inter, as in the apps. Figures are dots drawn as shapes, and `Text(timerInterval:)` uses the LifeOSDots font built from the same grid.
3. No Daily note widget.

## Built

| Part | Where |
| --- | --- |
| Snapshot query | `planner/widgets:snapshot` in `packages/backend/convex/planner/widgets.ts`. Times are moments; the widgets place them on the day in the snapshot's time zone |
| Shared Swift | `packages/widget-kit`: the `WidgetSnapshot` type, the store, the token, the tick intent, the parts, the strips and every tile. `swift test` covers the maths. `scripts/link.sh` links its files into the iPhone target and the Expo module; `scripts/make-dot-font.py` rebuilds the dot font |
| iPhone widgets | `apps/mobile/targets/widgets`, added by `@bacons/apple-targets` at prebuild. App Group `group.com.marss.lifeos`, Keychain group `BFKXU8H6X5.com.marss.lifeos.shared` |
| iPhone module | `apps/mobile/modules/lifeos-widgets` (pod `LifeOSWidgetBridge`): writes the snapshot, keeps the Convex token in the shared Keychain group, hands queued ticks to the app, runs the Focus Live Activity and passes the control's route. `src/lib/widgets.ts` drives it |
| Mac widgets | `apps/desktop/widgets`: an Xcode project made by XcodeGen from `project.yml` (regenerate with `nix run nixpkgs#xcodegen -- generate`), built by `widgets/build.sh` and embedded under `Contents/PlugIns` by `pnpm build:desktop`. App Group `BFKXU8H6X5.com.marss.lifeos` |
| Mac bridge | `apps/desktop/widgets/Bridge/Bridge.swift`, compiled into a static library by `src-tauri/build.rs`. `src-tauri/src/widgets.rs` has the commands, and `apps/web/src/components/app/widget-sync.tsx` writes the snapshot from the Mac app's webview |

Ticks go straight to Convex from the iPhone widget when the saved token is fresh. Otherwise, and always on the Mac, they wait in `ticks.json` in the App Group and the app sends them through `planner/tasks:complete` when it next runs. Start, Pause and Stop in the Live Activity and the Focus tile open the timer in the app instead of changing the session from the widget.

Shots of the real widgets, on the iPhone 17 Pro simulator against a seeded local backend: `widgets-built-home.png` and `-dark`, `widgets-built-home-small.png` and `-dark`, `widgets-built-home-tinted.png`, `widgets-built-home-clear.png`, `widgets-built-island.png`, `widgets-built-live-activity.png`, `widgets-built-control-*.png`.
