# LifeOS design system

The look and feel of LifeOS, for the engineers who build screens with it. The live specimen is the Waku route `/design` in `apps/web` (run `pnpm dev:web`, open `/design`). A screenshot is in `board.png`.

Three principles decide every choice:

1. **Calm, like paper.** Layers of tone, generous space, quiet chrome. Nothing shouts.
2. **Every touch answers.** Within a frame, physically, and it can always be undone.
3. **Time you can see.** Dots, rings and meters, drawn with care. Never a stock chart.

## Where things live

| What | Where |
| --- | --- |
| Tokens (colour, type, radius, shadow, motion) | `apps/web/src/styles.css` |
| Spring and easing presets for `motion` | `apps/web/src/lib/motion-tokens.ts` |
| Haptics helper | `apps/web/src/lib/haptics.ts`, `apps/mobile/src/lib/haptics.ts` |
| Foundation components (TuffUI, restyled) | `apps/web/src/components/ui` |
| LifeOS components | `apps/web/src/components/lifeos` |
| The board and its sample data | `apps/web/src/components/design-board` |
| iPhone palette (same values as hex) | `apps/mobile/src/lib/kit-theme.tsx` |

## Colour

Every colour is one CSS variable written with `light-dark()`, so a token has a single line and both themes. The page follows the system theme. Adding `.dark` or `.light` to `<html>` forces one. The Tailwind `dark:` variant follows the same rule.

| Token | Use |
| --- | --- |
| `background` | The page |
| `surface` | Shells and sidebars: the frame around a panel |
| `surface-inset` | Panels, where content sits |
| `surface-raised` | Selected and pressed steps |
| `popover` | Open Task cards, menus, toasts, the focus timer pill |
| `foreground`, `muted-foreground`, `faint-foreground` | The three text roles |
| `brand` | The one accent: selection, focus, charts |
| `deadline` | The Deadline flag, and nothing else |
| `positive`, `negative` | Confirmed and under Estimate; overdue and over Capacity |
| `area-violet`, `-green`, `-orange`, `-teal`, `-rose`, `-olive`, `-plum`, `-slate` | Area and Label colours |

Rules:

- Depth comes from tone, not borders. A layer is one step lighter or darker than the layer under it. Do not add a border to separate two surfaces.
- An Area colour appears as a dot, a tinted Work Block or a bar segment. Never as text or a full background. To tint a surface, mix in oklab: `color-mix(in oklab, var(--area-violet) 22%, var(--surface-inset))`. Mixing in oklch shifts the hue.
- The shadcn names (`card`, `primary`, `secondary`, `muted`, `accent`, `border`, `input`, `ring`, `destructive`) still work and point at the tokens above.

### Deadline against allocated time

These two never share a shape, a colour or a typeface.

| | Deadline | Allocated time (Estimate, planned start, Work Block) |
| --- | --- | --- |
| Meaning | The date it must be done by | How long, and when you will do it |
| Shape | A flag and a date | A figure, in a neutral chip or on a block |
| Colour | `deadline` amber, `negative` once overdue | Neutral ink, with `brand` or the Area colour on charts |
| Typeface | Inter | Geist Mono |
| Component | `DeadlineMarker` | `EstimateChip`, `CalendarStrip` |

## Type

Inter Variable (with optical sizing) for words. Geist Mono Variable for figures. The split is a rule: a time, an Estimate or a count is always `font-mono`, which also turns on tabular figures so digits hold their column while they roll. Dates stay in Inter. Geist Mono was picked because its slashed zero and even digit widths match the TuffUI references, and it sits well next to Inter.

| Utility | Size / line | Tracking | Weight | Use |
| --- | --- | --- | --- | --- |
| `text-display` | 44 / 46 | -3% | 600 | One per screen at most |
| `text-title` | 24 / 28 | -2% | 600 | View and day titles |
| `text-heading` | 17 / 24 | -1% | 500 | Card and section names |
| `text-body` | 15 / 24 | 0 | 400 | Task titles, body. The default |
| `text-small` | 13 / 20 | 0 | 400 | Area names, notes, controls |
| `text-micro` | 11 / 16 | 0 | 400 | Counts, axis labels |

Weights stop at 600. Sentence case everywhere. No uppercase labels. `cn()` in `src/lib/utils.ts` knows these size names, so `text-small text-muted-foreground` merges correctly. If you add a size, add it there too.

## Radius, spacing and elevation

- Spacing sits on the 4 px grid (Tailwind's scale).
- Radius: `rounded-sm` 6 (chips, keys), `rounded-md` 8 (menu rows), `rounded-lg` 12 (Task rows, Work Blocks), `rounded-xl` 16 (panels, open cards), `rounded-2xl` 22 (shells). Buttons and pills are fully round. An inner radius is the outer one minus the gap between them.
- Elevation: rest has no shadow. `shadow-lift` is for the thing in your hand (a dragged block, an open Task card). `shadow-float` is for what sits above the page (menus, toasts, the command palette, the focus pill). `shadow-well` is the shallow inset on switches and checkboxes.

## Motion

Motion is feedback. It starts on the first frame, follows the hand and gets out of the way.

| Token | Value | Use |
| --- | --- | --- |
| `--dur-press` | 120 ms | Press feedback |
| `--dur-fast` | 160 ms | Hover and tone changes |
| `--dur-base` | 220 ms | Popovers, the checkbox fill |
| `--dur-slow` | 320 ms | The strike-through and the tick drawing |
| `--dur-roll` | 600 ms | Odometer digits, rings |
| `--dur-linger` | 1100 ms | How long a finished Task stays before it leaves |
| `ease-out` | `cubic-bezier(0.23, 1, 0.32, 1)` | Enter and exit. The default |
| `ease-in-out` | `cubic-bezier(0.77, 0, 0.175, 1)` | Moving on screen |
| `ease-drawer` | `cubic-bezier(0.32, 0.72, 0, 1)` | Sheets and drawers |

Use them as `duration-(--dur-fast) ease-out`. Springs live in `motion-tokens.ts`:

| Preset | Feel | Use |
| --- | --- | --- |
| `spring` | 0.30 s, no bounce | Default for anything that moves |
| `springLift` | 0.28 s, bounce 0.12 | Picking something up |
| `springSettle` | 0.45 s, bounce 0.22 | Dropping it into place |
| `springLayout` | 0.40 s, no bounce | Rows and cards opening and closing |

Rules:

- Anything pressable answers on pointer down with `active:scale-[0.97]` (checkboxes go a little further).
- Never ease in. Never animate from `scale(0)`. Name the properties you transition; never `transition-all`.
- Bounce only when the hand gave the thing momentum (a lift or a drop). Everything else is critically damped.
- A drag tracks the pointer one to one, with pointer capture and no transition. It rubber-bands at the edges and springs to the snap point on release.
- Keyboard actions do not animate. The command palette opens instantly. Arrow keys move a Work Block or a segmented pill with no transition.
- Numbers that change roll (`RollingNumber`). Do not fade them.
- Every change raises an undo toast through `showUndo(title, undo)` from `lifeos/undo.ts`. Cmd+Z runs the newest one (`undoLast`).
- Reduced motion: keyframes stop, springs become instant, fills and strikes become a short fade. Check with `useReducedMotion()` from `motion/react` or the `motion-reduce:` variant.
- Server-rendered SVG that uses `Math.sin` or `Math.cos` must round its coordinates (`round` in `lifeos/format.ts`), or hydration will warn.

## Morphing text

A label that changes in place morphs: the letters it shares with the next label slide across, the rest fade. Use `MorphText` from `components/ui/morph-text.tsx` (it wraps Torph's `TextMorph` with our 280 ms ease-out).

- Use it for words and readouts that swap where they stand: Start and Pause on the focus pill, "Waiting for Things" becoming "Confirmed by Things", the Work Block's time range while you drag, a toast title that updates in place, a button label such as Save and Saving.
- Do not use it for numbers that count. Those roll (`RollingNumber`).
- It takes one plain string. Icons sit beside it, not inside it.
- Reduced motion: the text swaps instantly. Torph handles this itself.

## Haptics

One call, `haptic(name)`, from `apps/web/src/lib/haptics.ts`. Components name what happened. The helper picks the platform. The iPhone app has the same call in `apps/mobile/src/lib/haptics.ts`.

| Name | When | Mac app (trackpad) | Web on a phone | iPhone app |
| --- | --- | --- | --- | --- |
| `snap` | A drag crosses a 15 minute step | `alignment` | `selection`, a very light tick | Selection |
| `toggle` | A switch, checkbox, radio, segmented control or Start and Pause changes | `alignment` | `light` | Light impact |
| `drop` | A dragged thing is let go | `levelChange` | `medium` | Medium impact |
| `complete` | A Task or Checklist Item is ticked | `generic` | `success` | Success notification |
| `error` | An action is refused (every error toast) | `generic`, twice | `error` | Error notification |

- The Mac app calls the Tauri command `haptic` in `apps/desktop/src-tauri/src/haptics.rs`, which plays an `NSHapticFeedbackPattern` now. It is only felt with a finger on a Force Touch trackpad.
- Web on a phone uses `web-haptics`: the Vibration API on Android, the hidden switch on iPhone Safari. iPhone Safari only plays it inside a tap, so drag ticks may stay silent there.
- A desktop browser does nothing.

Rules:

- Fire on the event that caused it, in the same frame as the visual change. Never after an animation ends.
- Fire for a touch or a pointer. Never for scroll, hover or a keyboard action.
- Snaps are throttled to one every 50 ms inside the helper, so a fast drag ticks and does not buzz.
- Fire only when something changed. Unticking a Task is a `toggle`, not a `complete`.
- Do not add a new name for one screen. If none of the five fits, the moment probably does not need a haptic.

## Components

Foundation (`components/ui`, from the TuffUI registry): `surface` (Shell, Panel, Inset), `action-button`, `choice-controls` (Switch, Checkbox, RadioGroup), `status-pill` (StatusPill, Tag), `segmented-control`, `progress-bar` (ProgressBar, SegmentedBar), `rolling-number`, `toast-stack`, `key-hint`, `tooltip-hint`, `popover-panel`, `morph-text`. Add more with `pnpm dlx shadcn@latest add https://tuffui.com/r/<name>.json` from `apps/web`. They read our tokens, so most need no edits. Icons are Phosphor, fill weight, 16 px.

LifeOS (`components/lifeos`). All take plain props and make no backend calls.

| Component | File | What it is |
| --- | --- | --- |
| `SidebarItem` | `sidebar-item.tsx` | A list, Area or Project row with a rolling count |
| `TaskCheckbox`, `StrikeTitle` | `task-row.tsx` | The completion: fill, tick, strike. Dashed for Someday |
| `TaskRow`, `EstimateChip`, `DeadlineMarker` | `task-row.tsx` | The one-line Task |
| `TaskList` | `task-list.tsx` | Rows that linger, leave and can be undone |
| `TaskCard` | `task-card.tsx` | A Task opened in place: notes, When, Estimate chips, Labels, Checklist with drag handles, Deadline |
| `DayColumnHeader`, `CapacityMeter` | `capacity.tsx` | Planned time against free time as a dot strip (one dot is 15 minutes) |
| `CalendarStrip` | `calendar-strip.tsx` | A Work Block you can drag and resize, with External Commitments hatched |
| `FocusTimerPill`, `DotRing` | `focus-timer.tsx` | The floating timer with a draining ring of dots |
| `ShutdownSummary`, `AreaBar` | `review.tsx` | The end-of-day card with Actual Time by Area |
| `EstimateActual` | `review.tsx` | Two dot columns a day (one dot is 30 minutes) |
| `FocusHeatmap` | `review.tsx` | Hour by weekday |
| `ActivityTimeline` | `activity-timeline.tsx` | Completed Tasks as dots you can brush |
| `ProgressRing`, `ProgressPie` | `progress-ring.tsx` | Project progress, large and sidebar size |
| `CommandPalette` | `command-palette.tsx` | The palette shell: filter, arrows, Enter |
| `EmptyState`, `ThingsStatus` | `states.tsx` | The calm empty view, and "Waiting for Things" |
| `AreaDot` | `area.tsx` | The Area colour as a dot |

## The app shell

The real screens live in `apps/web/src/components/app`. They read Convex and compose the components above.

| Piece | File | What it does |
| --- | --- | --- |
| `AppShell` | `app-shell.tsx` | The sidebar on `surface`, the main column as one `surface-inset` panel, the phone drawer, the keyboard map, and a warm subscription to the five main lists so switching never waits |
| `Route` | `route.ts` | The one model of where you are: a list, an Area or a Project. `/area?id=` and `/project?id=` use a query string because the Mac app ships static files |
| `Sidebar` | `sidebar.tsx` | Lists with rolling counts, Areas with their Projects, the "Synced from Things" note, Sign out |
| `TaskItem` | `task-item.tsx` | A row that opens in place into its card. Things-owned fields are read-only for now, with "Open in Things" |
| Screens | `screens/` | Inbox, Today, Upcoming, Anytime, Someday, Logbook, Area, Project |

Keys: `1` to `6` (and Cmd+1 to Cmd+6 in the Mac app) switch lists. Arrow keys or `J` and `K` move through rows, or through the sidebar when it has focus. Enter opens a row, Escape closes it. A pointer switch slides the selection and fades the list in. A keyboard switch is instant.

`apps/web/scripts/screens.sh <folder>` screenshots every list in light and dark at 1440 and 390 px with agent-browser. Set `SESSION` to a JSON file with `accessToken` and `refreshToken` to start signed in.

## Building a new screen

1. Start from a `Shell` with a `Panel` inside. Put floating things on `popover` with a shadow.
2. Use the type utilities above. If it is a number of minutes, a clock time or a count, set it in `font-mono`.
3. Give every control a press state and every change an undo toast.
4. Draw data as dots, rings or meters from the components above before reaching for a chart library.
5. Check it at 1440 px and 390 px, in light and dark, and with reduced motion on.

## Art

The app is quiet on purpose, so art is the one place it gets rich. It appears in a few fixed places only, never as decoration on a working screen. Every image was made with an image model from a written prompt and then picked by hand.

| Kind | Component | Where it goes | Files |
| --- | --- | --- | --- |
| Mark | `LifeosMark` (`lifeos/mark.tsx`) | The logo: nine dots, four filled, "the day filling up" | Geometry in `lifeos/mark-geometry.ts` |
| App icon | none | iPhone (paper in light, graphite in dark), Mac (graphite), favicon (flat mark) | `apps/mobile/assets`, `apps/desktop/src-tauri/icons`, `public/favicon.svg` |
| Spot illustration | `SpotArt` | Empty screens, one per list and ritual. Has a light and a night version | `public/art/spots/{light,dark}` |
| Area cover | `AreaCover` | The head of an Area page. One per Area colour, built from painted dots | `public/art/covers` |
| Ritual scene | `RitualArt` | Daily planning, Focus Session, Shutdown, Inbox, Someday, day closed | `public/art/rituals` |
| Backdrop | `BackdropScene` | Behind a Focus Session and the rituals. Three sets (`blur`, `painted`, `room`), each at dawn, morning, afternoon, dusk and night | `public/art/{blur,painted,backdrops}` |
| Dot layer | `DotMatrix` (`lifeos/dot-matrix.tsx`) | Drawn live over a `blur` backdrop: a dot per cell, sized by the photo's brightness | none |
| Welcome backdrop | none yet | Paper or graphite with pressed dots, or the blurred sea | `public/art/backdrops/material-*`, `public/art/blur/sea.webp` |

Rules:

- One bright thing per screen. If a cover or a ritual scene is showing, everything around it stays tone and dots.
- Pick the backdrop from the clock with `backdropForHour(hour)`. Ask `backdropIsDark(backdrop, set)` whether text on it should be white.
- Spot illustrations blend into any surface: the light ones multiply, the dark ones screen, and the edges fade. Do not put them on a coloured background.
- Words go on the calm part of a backdrop. Every backdrop keeps its centre and upper two thirds plain for that reason.
- No text is ever baked into an image.

Rebuilding:

- `apps/web/scripts/build-art.sh <folder>` turns original PNGs into the web images, the phone icons and the Mac icon master. The folder holds `spots-light`, `spots-dark`, `backdrops`, `covers`, `painted`, `rituals`, `blur` and `icon`.
- `pnpm --filter @lifeos/web build:mark` rebuilds the favicon and flat marks. `node apps/web/scripts/build-mobile-marks.ts` rebuilds the Android, splash and favicon marks for the phone.
- After changing the Mac icon master (`apps/desktop/art/app-icon.png`), run `pnpm --filter @lifeos/desktop tauri icon art/app-icon.png` and keep the six files the app uses.
- The original PNGs live in `apps/web/art-source` on Avi's machine and are not committed (about 107 MB). The prompt that made each one is committed beside it as `<name>.prompt.txt`, so any image can be made again.
