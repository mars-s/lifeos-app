# LifeOS data model

This page describes every table the life OS needs: the ones built now and the ones later slices add. The schema in `packages/backend/convex/schema.ts` is the source of truth. It composes one `tables.ts` per module, so this page follows the same split. Words in **bold** are defined in `CONTEXT.md`.

Each index name lists its fields. Convex appends `_creationTime` to every index, so rows with equal keys come back in creation order.

## Conventions

- **Dates a person picks** (When, Deadline, Day Plan) are local calendar dates stored as `YYYY-MM-DD` strings and parsed with `parseIsoDate` at every boundary. **Moments** (Work Blocks, Focus Sessions, completion and trash times) are epoch milliseconds.
- **Order Keys** are fractional index strings from `fractional-indexing`. A drag writes one document. Keys sort as plain strings.
- **Status and placement are tagged unions**, never loose optional fields. A Task cannot be "completed" without a completion time, and a Heading cannot be set without its Project.
- **Things Links** are an optional `things { id, base? }` object on an imported record. `base` holds the values Things had at the last Things Import, which is how an import tells a field LifeOS changed from one it did not. The import writes the link without recording Activity, because it is bookkeeping, not a change Avi made.
- **Colours** are one of the eight design tokens: `violet`, `green`, `orange`, `teal`, `rose`, `olive`, `plum`, `slate` (`docs/design/system.md`).
- **Trash is a time, not a status.** `trashedAt` sits beside `status`, so a trashed Task keeps its status and comes back unchanged.
- Absent optional fields are missing, never `null`. Activity stores a missing field as `null`, because a stored record cannot hold `undefined`.

## Platform module (`convex/platform`)

Shared primitives every module uses.

### `activity`

One row per action: one mutation call, one undo, or one batch of a Things Import.

| Field | Type |
| --- | --- |
| `actor` | `{ kind: "avi" }`, `{ kind: "agentRun", jobId }`, `{ kind: "things" }` or `{ kind: "recurrence" }` (the Recurrence Rule generator) |
| `action` | Action name, such as `task.rename` or `things.import` |
| `at` | Moment |
| `undoes` | Optional. `{ kind: "activity", activityId }` or `{ kind: "run", jobId }` on an undo |

| Index | Serves |
| --- | --- |
| `by_run` (`actor.jobId`) | Undo a whole Agent Run. History of one run. |
| `by_undoes_activity` (`undoes.activityId`) | "Was this action undone?" |
| `by_undoes_run` (`undoes.jobId`) | "Was this run undone?" |

### `activityChanges`

The changes inside one Activity row, in order. Each holds enough to invert itself.

| Field | Type |
| --- | --- |
| `activityId` | `Id<"activity">` |
| `seq` | Position inside the action |
| `entity` | Record reference (any Entity Reference, an `entityLinks` row, or a setting row: `calendars`, `workingHours`, `dayPlans`, `features`, `taskTrips`), a `templates` row or a `recurrenceRules` row |
| `change` | `insert { after }`, `patch { before, after }` or `delete { before }`. `before` and `after` hold only the changed fields. |

| Index | Serves |
| --- | --- |
| `by_activity_seq` (`activityId`, `seq`) | Replay or invert one action |
| `by_entity` (`entity.id`) | History of one record, the Logbook timeline later |

### `entityLinks`

A link from any linkable thing to any other. Both ends use the Entity Reference validator `vEntityRef`, a union of `{ table, id }` pairs. Later modules add their tables to that union, which widens it without reshaping rows.

| Index | Serves |
| --- | --- |
| `by_from` (`from.id`) | Outgoing links of a record |
| `by_to` (`to.id`) | Backlinks: what points at this record (`platform/links:backlinks`) |

### `jobs`

One unit of background work.

| Field | Type |
| --- | --- |
| `job` | `{ kind: "agent", payload: { request, mode?, threadId?, taskId? } }`. An in-app run (`ai/runs.ts`) sets `mode` (`ask` for Cmd+J, `run` for work it acts on), the Agent component `threadId` that holds its messages, and the Task it was asked on. A new module adds its own kind. |
| `idempotencyKey` | Unique per logical piece of work |
| `status` | `queued { availableAt }`, `claimed { workerId, leaseUntil, heartbeatAt }`, `waiting { since }` (an in-app run waiting for Avi to approve a risky change), `done { at, receipt }` or `failed { at, error }` |
| `attempts` | Claims so far |

| Index | Serves |
| --- | --- |
| `by_idempotency_key` | Enqueue returns the existing Job for a repeated key |
| `by_kind_status_available` (`job.kind`, `status.kind`, `status.availableAt`) | Claim the oldest queued Job of a kind whose retry delay has passed |
| `by_kind_status_lease` (`job.kind`, `status.kind`, `status.leaseUntil`) | Claim a Job whose lease expired |
| `by_thread` (`job.payload.threadId`) | Find the Agent Run behind a thread, so its messages are only read through an owner query |

`claim` returns the Job with its attempt number. `heartbeat`, `complete` and `fail` must name that attempt, so a stale attempt cannot finish a Job its Worker has claimed again. Each kind sets its own limits in `jobKinds` (`platform/jobs.ts`): `agent` allows 1 attempt with a 15 minute lease. A failed attempt with `retry: true` waits 5 seconds, doubling up to 5 minutes. An expired lease returns the Job to whichever Worker claims next. After the last attempt the Job fails with `lease_expired`.

### `workers`

| Field | Type |
| --- | --- |
| `name` | Unique, such as `things` |
| `capabilities` | What this Worker may do: `agent` (a Job kind it may claim), `things` (send Things Imports), `calendar` (send Apple Calendar windows) or `notes` (send note projections, held by the Notes Relay's Worker `relay`) |
| `tokenHash` | SHA-256 hex of the Worker's token. The token itself lives only in that machine's keychain. |

Indexes: `by_name` (register, and `platform/workers:grant`, which adds one capability to a named Worker without touching its token), `by_token_hash` (authenticate every Worker call).

### `features`

One row per **Feature** Avi has changed, absent until then. The registry in `shared/features.ts` gives each Feature's defaults (`docs/architecture.md`, Features).

| Field | Type |
| --- | --- |
| `feature` | `ai`, `places`, `templates` or `smartBlocks` |
| `enabled` | Boolean |
| `settings` | The Feature's own settings, checked by its validator: `{ routes }` for AI, `{ travelMode: "drive" | "walk" | "cycle" }` for Places, `{}` for Templates, `{ areaOrder: Id<"areas">[] }` (Area Priority) for Smart Blocks |

The table is a union with one member per Feature, so a Places row cannot hold AI settings. Index: `by_feature`.

- AI's `routes` is a record from AI Capability id to `{ on, model }`. A missing route means the registry default. A `model` LifeOS no longer offers, or one that cannot answer what the capability asks, reads as the default, so removing a model never breaks a stored row. `ai/routing:setRoute` is the `changeMutation` that changes one route; `ai/routing:overview` returns each capability's switch, chosen model and the model that will actually answer (`answering`, the first of the chain whose provider has a key).

- `platform/features:list` returns every Feature with its effective `enabled`, `settings` and Feature Status.
- `setEnabled` and `configure` are `changeMutation`s. Undoing the first change deletes the row, which brings the defaults back.
- It replaced the old one-row `preferences` table (one `smartEstimates` boolean) on 19 November 2026. That table was empty on the live deployment, so no value had to move.
- The `smartEstimates` Feature became the AI Capability Smart Estimates on 19 November 2026 (#58). The live deployment had no `smartEstimates` row (it was on by default), so `ai/migrations:fromSmartEstimates` inserts an enabled `ai` row once, and Avi keeps Smart Estimates and Places as they were.

### `secrets`

One row per named API key Avi saves in Settings: `openai` and `opencodeGo`, one per AI Provider. The key itself is never stored in the clear and no query returns it.

| Field | Type |
| --- | --- |
| `name` | `openai` or `opencodeGo` |
| `iv` | Base64 of the 12-byte AES-GCM nonce |
| `ciphertext` | Base64 of the key sealed with AES-GCM under `LIFEOS_SECRETS_KEY`, with `lifeos-secret:<name>` as additional data so a row cannot be moved to another name |
| `last4` | The key's last four characters, for "Key saved, ends in abcd" |
| `savedAt` | When it was saved |

Index: `by_name`.

- **Saving.** `platform/secrets:save` is an `ownerAction`. It refuses an empty paste, refuses with `not_set_up` when `LIFEOS_SECRETS_KEY` is missing or is not 32 bytes of base64, then checks the key with its provider's cheapest authenticated call: `GET https://api.openai.com/v1/models` for OpenAI, `GET https://opencode.ai/inference/go/v1/models` for OpenCode Go. A 401 or 403 is `refused`. Only a key the provider accepts is sealed and stored, replacing any earlier one. It returns `{ last4, savedAt }`.
- **No Activity.** Saving and removing write through the internal `store` and `forget` mutations, not `changeMutation`, so neither the key nor its ciphertext reaches Activity or undo. Removing asks Avi to confirm instead.
- **Reading.** `platform/secrets:status` returns `{ last4, savedAt }` or `null`. Only the internal action path unseals a key (`revealSecret`, through `ai/routing:attemptsFor`, for every AI call). It uses the saved key first and falls back to the `OPENAI_API_KEY` or `OPENCODE_GO_API_KEY` env var. Mutations only ask `secretAvailable`, which never decrypts.

### `users`

One row per GitHub account that signed in. Convex Auth's components keep the sessions and the GitHub account link. Only the owner's row exists in practice, because sign-in refuses every other account (`docs/auth.md`).

| Field | Type |
| --- | --- |
| `githubId` | The numeric GitHub user id, as a string. The owner guard compares it with `LIFEOS_OWNER_GITHUB_ID`. |
| `login` | The GitHub username, for display |

No indexes: the guard reads the row by the id the session holds.

## Planner module (`convex/planner`)

### `tasks`

| Field | Type | Owner |
| --- | --- | --- |
| `title`, `notes` | string | LifeOS |
| `when` | `inbox`, `anytime`, `someday`, or `scheduled { date, evening }` | LifeOS |
| `deadline` | Optional local date | LifeOS |
| `estimateMinutes` | Optional, 1 to 12,000 (200 hours, so a Task can be estimated in working days or weeks). Dropping it on the Timebox makes one block of at most 4 hours | LifeOS |
| `parent` | `loose`, `area { areaId }` or `project { projectId, headingId? }` | LifeOS |
| `labelIds` | `Id<"labels">[]` | LifeOS |
| `status` | `open`, `completed { at }` or `canceled { at }` | LifeOS |
| `trashedAt` | Optional moment | LifeOS |
| `order` | Order Key inside its parent | LifeOS |
| `plan` | Optional `{ date, order }`: the Task's place in one day's **Day Plan**. It only counts while `date` is the day the Task is planned on, so an order made for Thursday never leaks into Friday | LifeOS |
| `repeat` | Optional `{ ruleId, date }`: the Recurrence Rule this Task is an occurrence of, and the occurrence date | LifeOS |
| `rollup` | Optional `{ checklistItems, workBlocks, focusSessions }`: how many of each a list row shows (live Work Blocks, Focus Sessions that count towards Actual Time). Derived, see below | Derived |
| `things` | Optional `{ id, todayIndex, base? }`: the Things id, its position in Things' Today, and the imported fields as Things last had them | Things Import |

| Index | Serves |
| --- | --- |
| `by_things_id` (`things.id`) | Things Import lookup |
| `by_trashed_status_when` (`trashedAt`, `status.kind`, `when.kind`, `when.date`) | Today (open, untrashed, scheduled on or before a date). Inbox, Anytime and Someday (one When kind each). Upcoming (scheduled after today, inside a window). The sidebar counts. |
| `by_trashed_status_deadline` (`trashedAt`, `status.kind`, `deadline`) | Today (due on or before a date). Upcoming Deadlines (due after today, inside a window). |
| `by_trashed_closed_at` (`trashedAt`, `status.at`) | The Trash list (every Task with a `trashedAt`, newest first). The Logbook: completed and canceled Tasks, newest first, paginated, and narrowed to a range of moments. Open Tasks have no `status.at`, so a lower bound of 0 leaves them out. |
| `by_project_order` (`parent.projectId`, `order`) | Project page. The last key when appending. |
| `by_area_order` (`parent.areaId`, `order`) | Area page. The last key when appending. |
| `by_parent_kind_order` (`parent.kind`, `order`) | Loose Tasks in order. The last key when appending. |
| `by_repeat` (`repeat.ruleId`, `repeat.date`) | The idempotency key for generation: one Task per rule per occurrence date. The current instance of an after-completion rule. |
| `search_title` (search on `title`, filter `status.kind`) | The MCP `search` tool: open Tasks by words in their title. |

### `areas`

`title`, `colour`, optional `icon`, `order`, optional `trashedAt`, optional `things { id, base? }`. Indexes: `by_things_id`, `by_order` (sidebar), `by_trashed` (`trashedAt`, the Trash list). A new Area from Things takes the colour at its Things position, cycling through the eight tokens.

### `projects`

`title`, `notes`, optional `areaId`, `when`, optional `deadline`, `labelIds`, `status`, optional `trashedAt`, `order`, optional `things { id, base? }`. Indexes: `by_things_id`, `by_area_order` (`areaId`, `order`) for the sidebar and Area page, `by_trashed` (`trashedAt`, the Trash list). Derived: optional `progress { done, total }`, the Project's live Tasks and how many of them are closed, which the sidebar, Area page and lists show without reading every Task.

### Derived fields

`tasks.rollup` and `projects.progress` are caches the change recorder keeps (`planner/rollups.ts`). When a recorded change writes a Checklist Item, Work Block or Focus Session, or inserts a Task, `finish` recounts that Task's `rollup`. When it inserts or removes a Task, or changes its `status`, `parent` or `trashedAt`, it recounts `progress` on the old and new Project. Each count happens once per change, at the end, so a change that touches 200 Tasks of one Project recounts it once. They are never recorded as Activity and undo ignores them, because undo's own writes recount them.

A row skips the Checklist, Work Block or Focus Session read when the count is 0, so a list reads one document per Task that has none. A Task with no `rollup` (written before it existed, or by a test straight to the database) is read in full, and a Project with no `progress` counts its Tasks, so a missing value is only slower, never wrong. `planner/rollups:backfill` (`table: "tasks"`, then it schedules `projects`) fills both in batches of 100, half a second apart so it stays well under the write limit. It is safe to run again.

### `headings`

`projectId`, `title`, `order`, optional `things { id, base? }`. Indexes: `by_things_id`, `by_project_order`.

### `labels`

`name`, `colour`, `order`, optional `things { id, base? }`. Indexes: `by_name` (a Things tag links to an unlinked Label of the same name), `by_things_id`, `by_order`. A Task holds its Label ids as an array. Views filter by Label in memory after an index read. A cross-module "everything labelled X" query adds a `labelLinks` table (`labelId`, `entity`) with a `by_label` index, without changing `labelIds`.

### `checklistItems`

`taskId`, `title`, `done`, `order`, optional `things { id, base? }`. Indexes: `by_task_order`, `by_things_id`.

### `workBlocks`

`taskId`, `start` (moment), `minutes`, `timeZone`, `done`, optional `removedAt`, optional `smartBlock { blockId, date }`. The end is `start + minutes`, so a block cannot end before it starts. Removing sets `removedAt`, so undo restores the same row and earlier actions on it stay undoable. `smartBlock` marks a Work Block placed by filling that Smart Block occurrence; a later fill keeps it.

| Index | Serves |
| --- | --- |
| `by_task_start` (`taskId`, `start`) | The Task card |
| `by_removed_start` (`removedAt`, `start`) | The Timebox calendar for a range |

Apple Calendar write-back adds an optional `calendarEvent { calendarId, eventKey }` field.

### `smartBlocks`

A **Smart Block**: a reserved window that LifeOS fills with Tasks. `shared/smartBlocks.ts` holds the fill engine and the occurrence rule as pure functions, shared with the web app as `@lifeos/backend/smartBlocks`.

| Field | Type |
| --- | --- |
| `title`, `colour` | The label on the Timebox (Focus, Admin, Errands) and one of the eight colour tokens |
| `date` | The local date of a one-off, or the first date of a series (the anchor `every` counts from) |
| `until` | The last date it can occur: `date` for a one-off, the end date of a series, or `9999-12-31` for a series that never ends |
| `startMinute`, `endMinute` | The window in minutes after local midnight, at least 15 minutes and ending by midnight. Wall-clock times, so a 16:00 block stays at 16:00 across daylight saving |
| `timeZone` | The IANA zone the window is read in |
| `filter` | `areaIds`, `projectIds`, `labelIds`. A Task is eligible when its Area or Project is listed (or both lists are empty) and it has one of the Labels (or the list is empty) |
| `repeat` | Optional `{ schedule, skipped }`: a Recurrence Rule calendar schedule (`days`, `weekdays`, `weeks`, `months`, `years`; not after-completion) and the dates skipped |
| `detachedFrom` | Optional `{ blockId, date }`: the series occurrence this one-off replaced when Avi edited only that day |
| `removedAt` | Optional moment. Deleting sets it, so undo restores the same row |

| Index | Serves |
| --- | --- |
| `by_removed_until` (`removedAt`, `until`) | Every live Smart Block that can still occur on or after a date: the Timebox range and the fill |

**Filling one occurrence.** `planner/smartBlocks:fillInputs` (`date`, `timeZone`) returns one snapshot for the date: open, untrashed Tasks whose When is Anytime or Scheduled on or before the date (with their Area, Project, Labels, Deadline, Day Plan key, Estimate and Smart Estimate), the live Work Blocks starting that day (with their `smartBlock` link), the External Commitments that take time, the Areas in priority order and 31 days of Capacity. `fillSmartBlock` then:

1. Keeps the occurrence's own Work Blocks whose Task is still open and eligible and which sit inside the window, plus any that started before now. The rest are released.
2. Ranks the eligible Tasks that have no other Work Block that day: `45 × urgency + 35 × area + 15 × committed + 5 × age`, each from 0 to 1. Urgency is the larger of Deadline nearness (1 when due or overdue, falling to 0 a week out) and scarcity (the Task's size over the free Capacity before its Deadline). Area is the Area's place in Area Priority, 1 for the first and 0 for the last; a Task without an Area gets 0.5. Committed is 1 when the Task is Scheduled on or before the date. Age counts days since creation, capped at 30. Ties go by Day Plan key, then Task id. Tasks Avi picked come first in his order; Tasks he left out are skipped.
3. Sizes each Task by its Estimate, else its Smart Estimate (a guess), else 30 minutes, rounded up to 5 minutes.
4. Packs in rank order, best fit: each Task goes in the smallest free gap that holds it, at the gap's start, then the gap shrinks by the Task plus 5 minutes. Free gaps are the window from now on, minus busy commitments and other Work Blocks, each padded by 5 minutes. A Task longer than the widest gap is skipped as too long. One that would fit an empty block but finds no room is skipped as no room, and listed as waiting.

The same inputs give the same fill. `planner/smartBlocks:fill` (`blockId`, `date`, `blocks`, `release`, optional `edit`) checks the occurrence exists, that each block sits inside its window, does not overlap another live Work Block and belongs to an open Task, and that each released block belongs to this occurrence, then writes everything in one `smartBlock.fill` Activity row. `edit` saves changes to this day (`scope: "one"`, detaching it) or to every one (`scope: "all"`, including the repeat) in the same row, so one undo reverts both.

Changes: `create` (with an optional first fill, one undo), `edit` (one date or the series), `skip` (one occurrence of a series, or deletes a one-off), `remove` (the series). Each refuses with `feature_off` while the Smart Blocks Feature is off, and `invalid_smart_block` with a reason (`window`, `time_zone`, `occurrence`, `outside`, `overlap`, `release`, `too_many`).

### `focusSessions`

One stretch of timed work, or one Pomodoro Break, on one Task.

| Field | Type |
| --- | --- |
| `taskId` | `Id<"tasks">` |
| `kind` | `focus` or `break`. Only `focus` counts as **Actual Time** |
| `start` | Moment |
| `plannedMinutes` | Optional. Missing on a Stopwatch session, which counts up |
| `pausedMs` | Milliseconds spent paused so far, not counting a pause still open |
| `state` | `running`, `paused { at }` or `ended { at }` |
| `pomodoro` | Optional `{ focusMinutes, breakMinutes, longBreakMinutes?, round? }`: the lengths the next step of the cycle uses, and which Pomodoro of four this is (1 when missing). The Break after round 4 is the Long Break |
| `removedAt` | Optional moment. Set when a session is removed from a Task's history, so undo restores the same row |

| Index | Serves |
| --- | --- |
| `by_task_start` (`taskId`, `start`) | Actual Time and the history on a Task row |
| `by_start` (`start`) | Analytics and the focus heatmap, later |
| `by_state` (`state.kind`) | The one running or paused session |

The clock is never stored and no server tick runs. `shared/focus.ts` works every figure out from these fields and the current time: focused time is the end (or now) minus `start` minus `pausedMs`, capped at `plannedMinutes`. The web app and the backend share that file (`@lifeos/backend/focus`), so a pill in two tabs and the stored Actual Time always agree. A session whose planned time has run out stays as it is until Avi finishes it, extends it or starts a Break. It gains no more time while it waits.

### `focusPlan`

One row, absent until Avi chooses: `mode` (`open` for Stopwatch, or `pomodoro`), `focusMinutes`, `breakMinutes`, `longBreakMinutes`. It is the Focus Plan the next session starts with, kept in Convex so the Mac app, the web and the iPhone agree. The default is a Stopwatch, with 25, 5 and 15 minutes ready for Pomodoro. `planner/focus:plan` reads it and `choosePlan` changes it (an undoable change, like any other). An agent's `start_focus` with `minutes` uses its Break and Long Break lengths.

### `estimateSuggestions`

One row per Task that has asked for a **Smart Estimate**. The suggestion never touches the Task's `estimateMinutes`. Avi's click sets that through `tasks:setEstimate`, like any other Estimate.

| Field | Type |
| --- | --- |
| `taskId` | `Id<"tasks">` |
| `requestedAt` | The latest request. A scheduled run with an older value has been replaced and does nothing |
| optional `answeredAt` | The `requestedAt` of the last run that finished, including one that found nothing to ask. The card shows thinking while `requestedAt` is newer |
| `outcome` | `waiting`; `suggested { minutes, guesses, modelMinutes, reason, confidence, probabilities, model, answeredBy?, inputsHash, at }`; `unclear { vague, answeredBy?, inputsHash, at }`; or `failed { error, inputsHash, at }`. `minutes` is the most likely guess and `guesses` are the up to three shown, each `{ minutes, probability }`, shortest first. `model` is what the provider reported; `answeredBy` is the LifeOS Model id that answered, such as `openai/decisions/gpt-6-luna` (absent on rows from before #58) |

Index: `by_task` (the card's query and every request).

### How a Smart Estimate lands

- **Asking.** A placeholder title (New Task, Untitled, To do, or one with no word of three letters or more) is never sent. `tasks:create` and a real `tasks:rename` call `requestSuggestion`, and so does opening the card of a Task with no row yet (`planner/smartEstimates:request`, an `ownerMutation` because it changes none of Avi's data). Nothing happens when the Task already has an Estimate, is closed or trashed, or the Smart Estimates capability has no model to ask (AI off or not `ready`, Smart Estimates switched off on the AI page, or no provider key that can answer). Otherwise it bumps `requestedAt` and schedules `suggest` two seconds later, so a burst of edits makes one call.
- **The signal.** `planFor` builds the title, notes (whitespace collapsed, cut at 600 characters), Checklist size, Area, Project and Label names, and up to 6 nearest past Tasks. Past Tasks are the last 300 closed Tasks plus any Task in the last 600 Focus Sessions. They rank by shared title words, then same Project, same Area and shared Labels. Each example sends only its title, Area, Project, Labels, Estimate and Actual Time. Other Tasks' notes and every id stay home.
- **The call.** On the default model, `POST https://api.openai.com/v1/decisions` with `gpt-6-luna`. On a chat model it is the same questions over Chat Completions with a strict JSON schema (`docs/architecture.md`, AI), read back into the same shape. The ask is one `choice` question (`estimate`) and one `predicate` (`too_vague`). The choices are seventeen buckets with readable values, each with a description of the kind of work that fits it, because the model reads both: `5 minutes` to `6 hours`, then `1 working day`, `2 working days`, `3 working days`, `1 working week` and `2 working weeks`. A working day is Avi's Working Hours (8.5 hours by default), so those buckets are stored as that many minutes. One long list beat a two-step ask (a coarse size, then the bucket inside it) in a live trial on 19 November 2026: they agreed on most titles, but the coarse step read "Plan a two-week Japan trip" as a day of work, and it costs two calls. `planner/smartEstimateTrial:compare` reruns that trial on any titles (`npx convex run`, nothing is stored). The fixed instructions come first in a developer message. The user message holds the Task as plain text (`Task:`, `Description:` from the notes, `Checklist:`, `Area:`, `Project:`, `Labels:`) and then the similar past Tasks as `input_json`. The title and notes are prose, so they go in as prose. The history is a list of records, which is what `input_json` is for. The request carries `prompt_cache_key`, but the prefix is under the 1,024 tokens caching needs, so every call is billed in full (about 300 to 900 input tokens, a fraction of a cent).
- **The answer.** A `too_vague` probability of 0.95 or more stores `unclear`. So does 0.7 or more while the model is under 0.6 sure of the size. The model also marks big, clear work as fairly vague (0.81 for "rewrite the entire db in rust", sure of its size at 0.99), so a confident size wins below 0.95. Otherwise the pick is nudged by Avi's run ratio: the median of Actual Time over Estimate across the examples (2 or more pairs), or else across all history (3 or more). A ratio outside 0.85 to 1.15 moves every option to the bucket nearest `minutes × ratio`, adding together options that land in the same bucket. The guesses are the three most likely buckets at 3% or more. The reason is written in LifeOS, not by the model: the closest example and, when it applies, the over-run.
- **Showing it.** `planner/smartEstimates:forTask` returns what the card's Estimate row draws: `presets` (Smart Estimates off, no key, or an Estimate set before any guess), `thinking` (three ghost chips), `guesses { guesses, likely, reason }` (these replace the preset chips, and stay after Avi picks one), or `fallback { why }` for a placeholder title, a vague Task or a failed call, which shows the presets with a quiet line saying why. The card gives up on thinking after 15 seconds and shows the presets. Guesses of a working day or more read as days and weeks ("3 days", "1 week"), and when the best guess is that big the row adds "Big one. Split it into a Project?" with a Break it into steps button: it asks the Break into steps capability when that is on, and opens the Checklist composer otherwise.
- **Once per change.** `inputsHash` is the SHA-256 of the chosen Model id, the signal and the ratio. A run whose hash matches the stored `suggested` or `unclear` outcome makes no call. A failure is retried on the next real change.
- **With Places.** AI `uses` Places. When Places is `ready`, the Task text sent to the Decisions API gains a `Travel` line saying the trip is added separately, so the model guesses only the time at the place. At read time `forTask` and the day load add the chosen Trip there and back (twice the travel time, rounded up to the minute) to every guess, and the reason starts "0:10 at Officeworks plus 0:10 there and back." Picking another branch or dismissing the Trip changes the guesses at once, with no new call.
- Whether AI is on and has a key is its Feature Status in `platform/features:list`. Whether Smart Estimates is on, and which model answers, is in `ai/routing:overview`.

### `dayPlans`

One row per date that has a **Goal**: `date` (local date), optional `goalMinutes` (0 to 1440). Index: `by_date`. A date with no row, or a row without `goalMinutes`, takes its Capacity as the Goal. `planner/plan:setGoal` (`date`, `minutes` or `null` to reset) records `plan.goal` Activity and can be undone. Resetting keeps the row and removes `goalMinutes`. The Shutdown ritual adds its fields to this row later.
### `recurrenceRules`

A schedule that creates a fresh Task each time it comes due. `shared/recurrence.ts` holds the date logic as pure functions, shared with the web app as `@lifeos/backend/recurrence`.

| Field | Type |
| --- | --- |
| `schedule` | `days { every }`, `weekdays`, `weeks { every, days }`, `months { every, on }`, `years { every, month, day }` or `afterCompletion { every, unit }`. Weekdays are ISO numbers, 1 for Monday to 7 for Sunday. `on` is `day { day }` or `weekday { nth, weekday }`, where `nth` is 1 to 4, or -1 for the last |
| `end` | `never`, `on { date }` or `after { count }` |
| `task` | The Task shape each occurrence starts from (see below) |
| `evening` | Whether occurrences land in This Evening |
| `timeZone` | The IANA zone the client sent. The rule's "today" is the date in this zone |
| `anchor` | Local date that `every` counts from: the day, week, month or year of the anchor is the first in the cycle |
| `next` | `due { date }`, `waiting` or `ended` |
| `lastDate` | Date of the newest occurrence. The Task with this `repeat.date` is the current instance |
| `count` | Occurrences created so far, for `end: after` |

| Index | Serves |
| --- | --- |
| `by_next` (`next.kind`, `next.date`) | The generator (due on or before a date). Upcoming (due inside a window). The Planner week (due on or before its last day) |

A month day past the end of a month falls on its last day, so the 31st gives 30 April and 28 or 29 February. A yearly 29 February falls on 28 February in common years. Bounds: `every` is 1 to 99 days, 52 weeks, 24 months, 10 years or 99 after completion. `weeks.days` is not empty and is stored sorted without repeats. `after.count` is 1 to 999.

`waiting` belongs to an after-completion rule whose current Task is still open. `ended` covers a rule that reached its end and one Avi stopped.

The Task shape (`vTaskShape`, shared with `templates`) is `title`, `notes`, optional `estimateMinutes`, `labelIds`, `parent`, `checklist` (up to 100 titles) and optional `deadlineOffsetDays` (0 to 365). An occurrence's Deadline is its date plus the offset.

### `templates`

The Task shape plus `order` (Order Key). Index: `by_order`. A Template is deleted outright, because nothing points at it, and undo puts it back as a new row. With the Templates Feature off, `saveFromTask`, `createTask`, `update`, `reorder` and `remove` refuse with `feature_off` and the rows stay.

### `thingsSync`

One row: `syncedAt`, the counts of the last Things Import per table, and `retiredAt` once Switch Day has run. Read by the "Synced from Things" note, which hides after Switch Day.

### `thingsTombstones`

`thingsId`. One row per Things id of a record that was deleted forever. Index: `by_things_id`. A Things Import skips a row whose id is here, so a record Avi deleted for good does not come back before Switch Day.

## Planner view queries

Each screen reads one query that returns exactly what it draws. All go through `ownerQuery`.

| Query | Screen | Reads |
| --- | --- | --- |
| `planner/sidebar:get` (`date`) | The sidebar: Inbox and Today counts, Areas in order, each with its open Projects and their `progress` | `tasks.by_trashed_status_when`, `areas.by_order`, `projects.by_area_order` |
| `planner/today:get` (`date`) | Today and This Evening | `tasks.by_trashed_status_when`, `tasks.by_trashed_status_deadline` |
| `planner/lists:inbox` | Inbox | `tasks.by_trashed_status_when` |
| `planner/lists:anytime` (`date`) | Anytime, grouped by Area and Project, with Today's Tasks included. Projects parked in Someday or scheduled later are left out | as the sidebar |
| `planner/lists:someday` | Someday Tasks by container, and Projects parked whole | as the sidebar |
| `planner/lists:upcoming` (`date`, `days`) | Each day after `date` that has Tasks or Deadlines, up to 90 days | both `by_trashed_status_*` indexes |
| `planner/lists:logbook` (`paginationOpts`, `from?`, `to?`) | Closed Tasks, newest first, one page at a time | `tasks.by_trashed_closed_at` |
| `planner/lists:logbookTimeline` (`from`) | One completion moment per closed Task since `from`, for the dot timeline. The client buckets them by local day | `tasks.by_trashed_closed_at` |
| `planner/lists:area` (`areaId`) | An Area page: its open Tasks and its Projects with progress | `tasks.by_area_order`, `projects.by_area_order` |
| `planner/lists:project` (`projectId`) | A Project page: open Tasks under their Headings, and progress over every Task | `headings.by_project_order`, `tasks.by_project_order` |
| `planner/labels:list` | The Label picker on a Task card | `labels.by_order` |
| `planner/plan:week` (`from`, `days` up to 31, `timeZone`) | The Planner's day columns: each day's open Tasks in Day Plan order, its **Day Load** (`plannedMinutes`, `guessedMinutes`, `unestimated`), its **Goal** (`goalMinutes`, `goalSet`) and its **Capacity**. `guesses` lists the Smart Estimates it counted, so the client can recount after an optimistic change. Tasks scheduled before `from` roll into the first day. Each day's `ghosts` are the Recurrence Rule occurrences in the window that are not made yet (every one, not only the next), and the Day Load counts their Estimates. A Task's Estimate counts at most the day's Goal | `tasks.by_trashed_status_when`, `workBlocks.by_removed_start`, `dayPlans.by_date`, `estimateSuggestions.by_task`, `recurrenceRules.by_next`, and the Capacity reads |
| `planner/smartBlocks:range` (`from`, `days` up to 62, `timeZone`) | The Timebox zones: each Smart Block occurrence in the range with its window as moments and minutes, filters, repeat and how many Work Blocks (and minutes) fill it. `{ on: false }` while the Feature is off | `smartBlocks.by_removed_until`, `workBlocks.by_removed_start` |
| `planner/smartBlocks:priority` | Area Priority in the Smart Blocks settings | `areas.by_order`, `features.by_feature` |
| `planner/workBlocks:range` (`from`, `to`, moments, up to 100 days) | The Timebox calendar: live Work Blocks with their Task rows. Blocks of completed Tasks stay (they show as done), blocks of trashed Tasks are left out | `workBlocks.by_removed_start` |
| `planner/recurrence:upcoming` (`date`, `days`) | The next occurrence of each Recurrence Rule after `date`, up to 366 days, with its title, Estimate, Area, Project, schedule, end and the rule's latest Task if it still exists. One row per rule | `recurrenceRules.by_next`, `tasks.by_repeat` |
| `planner/templates:list` | Templates in order, with their Labels, Area, Project and Checklist count | `templates.by_order` |
| `planner/trash:list` | Trash: trashed Areas, Projects and Tasks, newest first. A record that went to Trash with its Area or Project is counted on that row, not listed again | `tasks.by_trashed_closed_at`, `projects.by_trashed`, `areas.by_trashed` |

Every list row has the same shape (`enrich` in `planner/rows.ts`): the Task, plus its Area (title and colour), its Project, its Labels, its Checklist Items (with their Order Keys), its Work Blocks that are not removed, and `focus`: its Actual Time in milliseconds and its 12 newest Focus Sessions. A session shorter than a minute is left out of both. The Task's `rollup` decides which of those three reads happen, and the row leaves `rollup` out. A Task with a Recurrence Rule also carries `repeat { ruleId, date, active, schedule, end, next }`, where `active` is false once the rule has ended. A Task card opens from the row it already has, with no second read.

The card writes through `planner/tasks` (`rename`, `setNotes`, `setWhen`, `setDeadline`, `setEstimate`, `setLabels`), `planner/checklist` (`add`, `edit`, `tick`, `reorder`, `remove`) and `planner/labels` (`create`, `setColour`, `rename`, `remove`). `tasks:reorder` sets one Task's Order Key, for drag to reorder. `tasks:row` returns one Task by id in the shape the lists show, so a card opened on its own (the iPhone sheet) stays live and takes the same optimistic updates. `labels:rename` refuses a name another Label holds (`name_taken`). `labels:remove` takes the Label off every open Task and deletes it. It cannot be undone, because undo cannot bring a record back under its old id. `labels:create` takes an optional `taskId` and adds the new Label to that Task in the same action, so one undo removes both. A Label name is used once, ignoring case: creating it again returns the Label that exists.

Focus Sessions change through `planner/focus`. `start` (`taskId`, `plan`) ends whatever session is active and starts one on the Task, in one Activity row, so one undo brings the old session back. Starting on the Task already in focus changes nothing. `pause` and `resume` are safe to repeat. `stop` ends the session. `extend` adds minutes to a planned session and forgives the time that ran past the plan. `advance` moves a Pomodoro from focus to its Break and back. `setPlan` switches a running session between Stopwatch and Pomodoro. `setMinutes` and `remove` edit a finished session, because every field is editable. Only an open, live Task can start a session (`invalid_focus`, reason `task_closed`). Completing or trashing the Task, alone, in a selection or with its Project or Area, ends its session in the same Activity row. `planner/focus:current` returns the active session with its Task title and Area colour, or `null`.

The Planner, Today and Upcoming change a day through `planner/plan:place` (`taskId`, `date`, `order`, optional `evening`). `order` is the day's (or the This Evening section's) Task ids as Avi sees them after the drop, with the moved Task in its new place. The Task's When becomes that Scheduled date, in This Evening when `evening` is true (it keeps its own evening flag when `evening` is left out) and it gets a `plan` key between its neighbours. When a neighbour has no key for that day yet, the whole day is keyed in the order given. One Activity row, so one undo restores the When and every key. `shared/plan.ts` holds the ordering (`byDayPlan`, `placeInDay`) and the planned total (`plannedMinutes`), and the web app runs the same code for its optimistic update.

A day's load comes from `dayLoad` in `shared/plan.ts`, which the web app runs too. Each Task counts its Work Blocks on that day, or else its Estimate (`plannedMinutes`), or else its Smart Estimate (`guessedMinutes`, only while Smart Estimates is on and the suggestion would show on the card). A Task with none of these adds one to `unestimated`. Tasks without an Area count like any other. A Work Block for a Task planned on another day also counts on the day the block starts. Completed and trashed Tasks count nothing. `planner/workBlocks:create` takes an optional `date`: the Task's When becomes that Scheduled date in the same Activity row, which is how dropping an Inbox Task on the calendar plans it for that day. `planner/tasks:create` takes an optional `place` (`{ date, order, at }`: the day's Task ids and the spot for the new Task) and keys the day in the same Activity row, which is how a + dropped mid-Today lands exactly there. It also takes an optional `block` (`{ start, minutes, timeZone }`) and inserts that Work Block in the same `task.create` Activity row, so pressing N over a free time on the Timebox makes the Task and its block in one undoable change. No Work Block change ever touches the Deadline.

`planner/tasks:duplicate` copies a Task (title, Notes, When, Deadline, Estimate, parent, Labels and Checklist Items) into one `task.duplicate` Activity row, so Undo removes the copy and its items together. The copy is open, takes no Repeat, Work Blocks or Focus Sessions, and its Order Key sits between the original and the next Task in the same Area, Project or loose list (`nextTaskOrder` reads `by_project_order`, `by_area_order` or `by_parent_kind_order`).

**Spread** works in two steps. The web app plans it with `spreadDay` in `shared/spread.ts` and shows the result as ghost blocks on the Timebox. It takes the day's open Tasks in Day Plan order, skips any that already have a Work Block that day, and sizes each by its Estimate, its Smart Estimate or 30 minutes, rounded to the 15 minute grid. Busy time is the day's External Commitments that take time, every Work Block on that day (done ones too) and the Sleep Window, each padded by 10 minutes. The window is Working Hours, starting no earlier than now on today. Each Task goes in the first gap after the previous one that fits it, on a 5 minute grid. A Task that fits nowhere is reported and the next one is tried. On confirm, `planner/workBlocks:spread` (`blocks` of `{ taskId, start, minutes }`, up to 100, and `timeZone`) inserts them all in one `workBlock.spread` Activity row, so one undo removes the Spread. It refuses the whole request when a block overlaps a live Work Block or another block in it (`invalid_block`, reason `overlap`), or names a Task that is closed or trashed. It never touches When or the Deadline. The web preview also treats every Smart Block window that day as busy, filled or not.

A selection of Tasks changes through `planner/selection` (`setWhen`, `setDeadline`, `setEstimate`, `setLabel`, `move`, `complete`, `reopen`, `trash`, `restore`). Each takes `taskIds` (up to 500), validates the whole request first, and records one Activity row, so one undo reverts every Task. A missing Task or an invalid value changes nothing.

Areas change through `planner/areas` (`create`, `rename`, `setColour`, `setIcon`, `reorder`, `trash`, `restore`) and Projects through `planner/projects` (`create`, `rename`, `setNotes`, `setWhen`, `setDeadline`, `move`, `complete`, `reopen`, `trash`, `restore`). A new Area takes the first colour no live Area uses. An icon is a kebab-case name from the web icon set. Trashing an Area or a Project also trashes its live Projects and Tasks with the same `trashedAt`, in the same Activity row. Restore (or undo) brings back only the records that share that moment, so a Task trashed earlier stays in Trash. Completing a Project completes its open Tasks with the Project's completion moment, and reopening it reopens only those.

Trash changes through `planner/trash` (`restore`, `deleteForever`, `empty`). `restore` takes a mixed list of Tasks, Projects and Areas and records one Activity row. A Task put back while its Project or Area is still in Trash moves to the nearest live parent (the Project's Area, or no parent). `deleteForever` removes a trashed record with its Checklist Items, Work Blocks, Headings and links. What was trashed with a Project or Area goes with it, and anything put back since is kept and moved out. `empty` deletes one batch of 100 per call and returns `done`, so the client calls it until Trash is clear. Both refuse a record that is not in Trash (`not_trashed`), and undo refuses both (`not_undoable`, reason `permanent`).

Recurrence Rules change through `planner/recurrence`. `setRepeat` (`taskId`, `schedule`, `end`, `timeZone`) starts a rule for a Task, or edits the rule it already has. A new rule takes a snapshot of the Task as its shape, and the Task becomes the first occurrence: a calendar schedule moves it to the first matching date on or after today (or its own later date), and an after-completion schedule leaves its When alone and waits for it. An end that comes before the first occurrence is refused (`invalid_schedule`, reason `end`). An edit replaces the schedule, end and shape and works out `next` again from the day after the newest occurrence, or today if that is later. Tasks already created keep their fields. When the schedule itself is unchanged, the anchor stays, so a fortnightly rule keeps its rhythm through an edit to its end. `stopRepeat` (`taskId`) and `stopRule` (`ruleId`) end the rule and keep every Task. Upcoming uses the Rule ID so it can stop a series whose latest Task was deleted. `skip` (`ruleId`, `date`) moves past the due occurrence without creating it, and refuses any date but the one due (`stale_occurrence`). If any of these leaves an occurrence due today, it is created in the same Activity row.

`internal.planner.recurrence.generate` runs every five minutes (`convex/crons.ts`). It reads up to 100 rules due on or before tomorrow in UTC, because no zone is more than 14 hours ahead, and schedules itself again when it fills a batch. For each rule whose `next` date has come in its own zone, it creates the occurrence, unless a Task already holds that rule and date. It writes one Activity row per rule with the `recurrence` actor. A generated Task takes the shape's fields, drops Labels that no longer exist, falls back from a trashed or missing Area or Project the way Trash restore does, gets new Checklist Items, and goes after its last sibling. Completing an after-completion rule's current Task, alone, in a selection or with its Project, sets `next` to the completion date plus the interval, in the same Activity row, so undo reverts both. Reopening that Task sets the rule back to `waiting`.

Templates change through `planner/templates`. `saveFromTask` (`taskId`, `today`) takes the same snapshot as a rule. `createTask` (`templateId`, `when`, `parent?`, `today`) creates a Task with its own Checklist Items. The Template's parent wins unless it is loose, then `parent` is used. The Deadline is the scheduled date (or `today`) plus the offset. `update` (`templateId` and any shape field) validates like the Task setters, and refuses more than 100 Checklist titles or an offset outside 0 to 365 (`invalid_template`). `reorder` (`templateId`, `targetId`, `placement`) moves a Template before or after another by changing one Order Key. The move can be undone. `remove` deletes the Template.

`planner/seed.test-utils.ts` builds a realistic planner (five Areas, six Projects, Headings, Deadlines, a Logbook). The list tests use it, and a scratch local backend can run it for visual checks.

## Notes module (`convex/notes`)

The notes themselves (Yjs documents) live on every device and in the Notes Relay (`docs/architecture.md`, Notes: local-first). Core keeps only the searchable copy each note's relay object sends when the note goes quiet. Embeddings of note sections belong to the AI module's `aiIndex`, not to this table.

### `notes`

| Field | Type |
| --- | --- |
| `docId` | The Yjs document id, which is also the relay's Durable Object name. Clients make it. A daily note's is `day-YYYY-MM-DD`, so two devices that start the same day offline write into one document |
| `title`, `titleKey` | The first line without its heading mark, and the same lowercased with spaces collapsed, for resolving `[[Note title]]` links |
| `excerpt` | Up to 280 characters of the body as plain text |
| `searchText` | Title, excerpt and Label names, for the search index |
| `words` | Word count |
| optional `areaId`, optional `projectId` | The folder from the note's `meta` map. A Project folder also sets its Area |
| `labelIds` | Labels whose name matches a `#tag` in the text, ignoring case. A tag with no Label is skipped |
| optional `day` | `YYYY-MM-DD` for a daily note |
| `updatedAt` | When the relay last sent this copy. Devices catch up from it |
| optional `trashedAt` | Set by `notes/notes:trash`, which records Activity, so undo brings the note back. A later projection keeps it |

| Index | Serves |
| --- | --- |
| `by_doc` | The relay upserts by document, and `get` and `links` |
| `by_updated` | `changedSince`: every copy newer than a device's last sync |
| `by_area_updated`, `by_project_updated` | The Area and Project trees |
| `by_day` | The daily note for a date |
| `by_title_key` | Resolving `[[Note title]]` |
| `by_trashed` | `list` (live notes) |
| `search_text` (search on `searchText`, filter `areaId`) | `search`, the command bar and the MCP `search_notes` tool |

`notes/relay:project` is a `workerMutation` that needs the `notes` capability. It writes the row and rebuilds the note's outgoing `entityLinks` from its text: `[[task:<id>]]`, `[[project:<id>]]` and `[[area:<id>]]` chips, and `[[Note title]]` links to notes that exist. It records no Activity: the row is a copy of the document, and the next projection rewrites it. For the same reason undo ignores links whose `from` is a note when it checks what depends on a record, so making a Task from a line can always be undone, and the next projection drops the link to a Task that is gone.

Owner queries: `notes/notes:list`, `search`, `get`, `changedSince`, `links` (what a note links to, and the notes that link to it) and `forEntity` (the notes that link to a Task, Project or Area). MCP serves `list_notes`, `search_notes` and `get_note` from the same rows.

## Calendar module (`convex/calendar`)

Apple Calendar, read by the Mac app and mirrored here as **External Commitments**. Read only: nothing in LifeOS writes to Apple Calendar yet. Apple Calendar owns these rows, so the mirror records no Activity and cannot be undone. Only Avi's settings (which calendars count, working hours) go through `changeMutation`.

### `calendars`

One row per Apple Calendar on the Mac.

| Field | Type |
| --- | --- |
| `calendarId` | EventKit's `calendarIdentifier` |
| `title`, `source` | The calendar's name and its account (iCloud, On My Mac, Exchange) |
| `colour` | The calendar's own colour as `#rrggbb` (sRGB). Not one of the eight tokens: it is Apple's colour, shown as the Things reference shows it |
| `kind` | `local`, `calDAV`, `exchange`, `subscription` or `birthday` |
| `included` | Whether it counts. A new calendar counts unless it is a subscription (holidays) or Birthdays. Avi changes it in the Calendars panel |

Index: `by_calendar_id` (the sync). A calendar that leaves the Mac's list is deleted. Its commitments inside the window go with the next window.

### `externalCommitments`

One row per event occurrence.

| Field | Type |
| --- | --- |
| `calendarId` | The calendar it belongs to |
| `eventKey` | Its identity. A one-off event is EventKit's `eventIdentifier` (or `calendarItemIdentifier` when that is missing). A recurring occurrence is `<eventIdentifier>@<occurrence date in ms>`, using the original date, so moving one occurrence keeps its row |
| `title`, optional `location` | As in Calendar. An untitled event reads "Busy". Notes, URLs and attendees are never read |
| `start`, `end` | Moments. An all-day event starts at local midnight and covers whole days |
| `allDay` | Boolean |
| `availability` | `busy`, `free`, `tentative`, `unavailable` or `unknown` (the calendar does not say) |
| optional `response` | Avi's own reply to an invitation: `accepted`, `declined`, `tentative` or `pending`. Nothing else about attendees is read |
| `recurring` | Whether it is one occurrence of a series |

| Index | Serves |
| --- | --- |
| `by_event_key` | The sync finds the row for an occurrence |
| `by_start` | A range of days. The range query reads from 14 days before its start, so an event already under way still shows. An event longer than 14 days is the one case it misses |

### `calendarSync`

One row: `syncedAt`, `windowStart`, `windowEnd` of the last window the Mac sent. The Calendars panel shows how long ago that was.

### `workingHours`

One row, absent until Avi changes it: `startMinute`, `endMinute` (minutes after local midnight). The default is 9:00 to 17:30, every day.

### How a window lands

The Mac app sends `calendar/sync:applyWindow` (a `workerMutation`, needing the `calendar` capability) with `{ window, calendars, commitments }`. The window runs from 7 days back to 61 days ahead, on whole UTC days, so it stays the same all day.

- Calendars are upserted by `calendarId`. Missing ones are deleted.
- Each commitment is upserted by `eventKey`. An unchanged row is not written. A commitment for a calendar the Mac did not list is skipped and counted.
- A row whose `start` is inside the window and whose key the Mac did not send is deleted. Rows outside the window are never touched.
- The reply counts what happened: `inserted`, `updated`, `unchanged`, `removed`, `skipped`. Sending the same window twice changes nothing.

### Capacity

**Capacity** is free time in a day inside working hours, after the commitments that take time.

- A commitment takes time when its availability is `busy`, `tentative` or `unavailable`, or `unknown` on a timed event.
- `free` events, events Avi declined, and all-day events (unless marked busy) leave the time free.
- Overlapping commitments count once. Time before or after working hours does not count.
- Days are local dates in the time zone the client names. Working hours keep their wall-clock times across a daylight saving change.

| Query | Screen | Reads |
| --- | --- | --- |
| `calendar/commitments:range` (`from`, `to`, moments, up to 100 days) | Upcoming, Today, later the Timebox calendar | `externalCommitments.by_start`, `calendars` |
| `calendar/capacity:days` (`from`, `days` up to 62, `timeZone`) | Today's free time, later the Planner's day columns | as above, and `workingHours` |
| `calendar/calendars:list` | The Calendars panel | `calendars`, `calendarSync` |
| `calendar/workingHours:get` | The Calendars panel | `workingHours` |

Changes: `calendar/calendars:setIncluded` (`calendar.include`) and `calendar/workingHours:set` (`calendar.workingHours`, refuses a span that is empty, negative or past midnight with `invalid_hours`). Both record Activity and can be undone.

## Health module (`convex/health`)

Avi's Oura ring, read through Oura's API v2 with OAuth. Oura owns these rows, so the sync records no Activity and cannot be undone. Nothing is written to Oura. The Planner draws the **Sleep Window** from them on the Timebox.

### `healthDays`

One row per Oura day (the date Avi woke up), keyed by `source` (`oura`) and `day`.

| Field | Type |
| --- | --- |
| `day` | `YYYY-MM-DD`. Oura files a night under the morning it ends |
| optional `sleep` | The longest `long_sleep` period that day: `start`, `end` (moments), `offsetMinutes` (Oura's local offset at wake), optional `asleepMinutes`. Naps, rests and deleted periods are ignored |
| optional `sleepScore` | From `daily_sleep` |
| optional `readinessScore` | From the sleep period's own `readiness` block, so it costs no extra call |
| optional `sleepTime` | From `sleep_time`: Oura's `status` (`not_enough_nights`, `not_enough_recent_nights`, `bad_sleep_quality`, `only_recommended_found`, `optimal_found`), its `recommendation`, and the bedtime `window` (`startOffset`, `endOffset` in seconds from that day's local midnight, negative before midnight, and `dayTz`) |
| `syncedAt` | When the row was last written |

Index: `by_source_and_day` (the sync upserts by day, the Sleep Window reads a range of days and the latest 30).

### `ouraConnection`

One row, absent until Avi connects Oura. `accessToken`, `refreshToken`, `expiresAt`, the granted `scope`, `connectedAt`, and `sync` (`never`, `ok` with `at`, or `failed` with `at`, the error and the last good sync). Only internal functions read the tokens. `health/sleep:status` returns `sync` and nothing else from this row. Oura's refresh tokens are single use, so a refresh only writes when the stored refresh token is still the one it used.

### `ouraAuthStates`

One row per Connect in flight: `state`, the PKCE `verifier`, `expiresAt` (10 minutes). The callback deletes the row whatever happens, so a state works once. Index: `by_state`.

### How Oura lands

- **Connect.** `health/oura:connect` (an `ownerMutation`) writes a state row and returns Oura's authorise URL with the `daily` scope, the state and an S256 PKCE challenge. Oura sends Avi back to `https://<deployment>.convex.site/oura/callback`, which takes the state, trades the code (with the verifier) for tokens, stores them and queues a sync. Connect and Sync now are `ownerMutation`s, not `changeMutation`s: they touch credentials, not Avi's data, and Activity must never hold a token.
- **Sync.** `health/oura:sync` (an internal action) runs from the cron at quarter past every fourth hour, after a connect, and from **Sync now** (`health/oura:syncNow`). It refreshes the token when it has under five minutes left, then reads `sleep`, `daily_sleep` and `sleep_time` from 16 days back to tomorrow and upserts one `healthDays` row per day. An expected failure (not set up, not connected, token refused, Oura refused access, rate limit, Oura down, a body it cannot read) is a `neverthrow` error stored on `ouraConnection.sync`. Rows already there stay.

### The Sleep Window

`health/sleep:nights({ from, days, today, timeZone })` returns one night per wake date from `from` to `from + days`, because a column's morning belongs to that date's night and its evening to the next. Each night is a moment range the client clips to its columns.

- A night Oura recorded is `slept`: its real `start` and `end`, with `asleepMinutes`, `sleepScore` and `readinessScore`.
- A night from `today` on with no record is `planned`. Bedtime is the start of Oura's latest bedtime window (`bedtime: "oura"`, with the window's end as `latestBedtime`). Oura gives no wake time, so wake is Avi's usual wake: the median wake time of his last 14 recorded nights, rounded to 5 minutes. With no Oura window (`not_enough_nights`), bedtime falls back to his usual bedtime the same way (`bedtime: "usual"`).
- With fewer than 3 recorded nights there is no plan, and nothing is drawn for the future.
- An earlier night with no record shows nothing.

`health/sleep:status({ today })` says whether Oura is set up (`OURA_CLIENT_ID` and `OURA_CLIENT_SECRET` are on the deployment) and connected, the last sync, Oura's latest status and recommendation, the plan, and how many nights it counted.

## Places module (`convex/places`)

The tables behind the Places Feature (`docs/architecture.md`, Features). Everything here is read only by the owner.

### `savedPlaces`

One row per **Saved Place**: `label` (`home`, `work` or `uni`), the `address` as Avi typed it, its `position` (`{ lat, lon }`), `found` (the short street and suburb the geocoder matched, shown under the field) and `savedAt`. Index: `by_label`.

- `places/saved:save` is an `ownerAction`. It refuses an empty address, reuses the stored position when the same address (ignoring case and spacing) is already saved, and otherwise asks Nominatim once. An address Nominatim cannot match is `not_found`.
- Saving and removing write through the internal `store` and `forget`, not `changeMutation`, so the address never reaches Activity. Removing asks Avi to confirm instead.

### `taskTrips`

One row per Task Places has looked at.

| Field | Type |
| --- | --- |
| `taskId` | `Id<"tasks">` |
| `requestedAt` | The latest request. A scheduled run with an older value has been replaced and does nothing |
| `outcome` | `waiting { query? }` (`query` is set once the model has named the place and the search is running); `none` (needs no trip); `unfound { query, mode, from }`; `found { query, mode, from, places }`; or `failed { error, query? }` (`query` is set when the search failed, not the model). Every outcome but `waiting` has `inputsHash`, `at` and, from #58, `answeredBy` |
| `choice` | `nearest`, `picked { key }` or `dismissed`. Changed only by `places/trips:choose` and `dismiss`, which are `changeMutation`s |

`from` is Home rounded to three decimal places, the position that was sent out. Each place is `{ key, name, suburb?, position, straightMetres, travel? { seconds, metres } }`, where `key` is the OpenStreetMap element (`node/123`). Index: `by_task`.

### How a Trip lands

- **Asking.** `tasks:create` and a real `tasks:rename` call `requestTrip`, and so does opening the card (`places/trips:request`, an `ownerMutation`, which asks again only when there is no row, the last run failed, a search has been `waiting` for over a minute, or Home or the Travel Mode changed since. Asking again after a failed search puts the row straight back to `waiting` with its `query`, so the card shows it looking at once). Nothing happens unless Places is `ready`. It schedules `locate` two seconds later.
- **The call.** The Trip detection capability's model (by default `POST /v1/decisions` with `gpt-6-luna`): a `needs_trip` predicate and a `place` choice over up to 24 phrases cut from the title (one to three words, not starting or ending with a small word or an errand verb), 14 kinds of place, and "no particular place". Only the title is sent.
- **The search.** A `needs_trip` probability under 0.5 or no place stores `none`. Otherwise `places/trips:searching` stores `waiting { query }` first (unless the row already holds a Trip to the same place), so the card can say what it is looking for while the slow calls run. Then Overpass searches 15 km around the rounded Home, by tag for a kind of place, or by `brand` (starts with) and `name` (contains) for anything else. The nearest five by straight-line distance go to one OSRM `table` call on `routing.openstreetmap.de` (`routed-car`, `routed-foot` or `routed-bike`), and are ordered by travel time. If routing fails, the five are kept without travel time.
- **Once per change.** `inputsHash` is the SHA-256 of the model name, title, phrases, rounded Home and Travel Mode. A run whose hash matches the stored outcome makes no call. A new place query resets `choice` to `nearest`.
- `places/trips:forTask` returns the Trip only when Places is `ready`: `{ kind: "trip", query, mode, from, chosen, places }`, `{ kind: "unfound", query, mode }`, `{ kind: "looking", query, since }` while the search runs, `{ kind: "failed", query }` when the search failed, or `null` (no trip, dismissed, the model has not answered yet, or the model failed). `since` is `requestedAt`: the card treats a search older than `TRIP_LOOK_LIMIT_MS` (one minute, in `shared/features.ts`) as failed and offers Try again.

## AI module (`convex/ai`)

Providers, Models and AI Capabilities are declared in `shared/ai.ts`. The module holds the transports (`ai/transport`), the routing (`ai/routing`) and the one table below.

### `stepSuggestions`

One row per Task Avi asked to **Break into steps**.

| Field | Type |
| --- | --- |
| `taskId` | `Id<"tasks">` |
| `requestedAt` | The latest request. A scheduled run with an older value has been replaced and does nothing |
| optional `answeredAt` | The `requestedAt` of the last run that finished |
| `outcome` | `waiting`; `suggested { steps, project, answeredBy, inputsHash, at }`; or `failed { error, inputsHash, at }`. `steps` are up to 8 cleaned, de-duplicated titles; `project` says the model thinks the work is big enough for a Project |

Index: `by_task`.

- `ai/steps:request` (an `ownerMutation`) bumps `requestedAt` and schedules `suggest` at once. `again: true` forgets the cached answer so the model is asked afresh. A run whose `inputsHash` (chosen Model id, title, notes, Estimate and current Checklist titles) matches the stored answer makes no call.
- `ai/steps:forTask` returns `off`, `idle`, `thinking`, `steps { steps, project, answeredBy }` or `failed { error }`.
- `ai/steps:accept` is a `changeMutation`: it inserts the titles Avi kept, in his order, after the last Checklist Item, then deletes the row. One undo removes every inserted item. `dismiss` deletes the row. Neither the row nor the model's text is in Activity.

## Tables later slices add

Each slice adds these as new tables, or as variants of `vEntityRef` and `vJob`. None reshapes a table above.

### Calendar write-back

- Writing Work Blocks to Apple Calendar adds an optional `calendarEvent { calendarId, eventKey }` to `workBlocks`, and a Mac-side writer that only changes events LifeOS created.

### Rituals

- **`dayPlans`** gains `capacityMinutes` and optional `shutdown { at, note }` with the Shutdown ritual, to freeze what a day's plan was. Until then a Day Plan is read live from the Tasks scheduled on that date and their `plan` keys, and the row holds only the Goal.

### Saved Links

- **`savedLinks`**: `url`, `title`, optional `summary`, optional `areaId`, `labelIds`, optional `embedding`, `status` (`captured`, `indexed`, `failed`), `capturedAt`. Indexes: `by_url` (no duplicates), `by_captured` (newest first). Search and vector indexes as for Notes. Indexing is an `index:link` Job.

### Agents

- An **Agent Run** is a Job of kind `agent`. Its changes carry the actor `{ kind: "agentRun", jobId }`, and `platform/undo:undoRun` reverts the whole run.
- An **MCP connection's run** is the same kind of Job, made by `platform/agentRuns.ts` on its first write. Its `idempotencyKey` is `mcp:<connectionId>:<started at>`, so `by_idempotency_key` finds a connection's latest run. It is `claimed` by the Worker named `mcp` (no capabilities, a token nobody holds) with a lease of 10 minutes, and each write extends it. A write after the lease runs out marks the old run `done` and starts a new one. Its `request` is `<connection name> over MCP`.
- **`agentMessages`**: `jobId`, `role`, `content` (structured, for generative UI), `at`. Index: `by_run_at`. Added with the first conversational agent.

### Search

One search across modules: a search index on `title` for `tasks` and `projects`, and the Notes and Saved Links search indexes above, merged by one query in the Platform module.

## How a change flows

1. A public mutation built with `changeMutation` (`platform/change.ts`) resolves the actor. With no `agentRun` argument the actor is Avi. With `agentRun: { token, jobId }` it must be a claimed `agent` Job held by that Worker.
   An MCP write tool runs the very same change through `changeAs` (`platform/change.ts`), inside an internal mutation built with `agentMutation`, with its connection's run as the actor. `changeMutation` keeps each mutation's spec, so the two paths cannot drift.
2. The handler validates its input and returns a `Result`. It writes only through the recorder (`platform/activity.ts`), which records each insert, patch and delete in `activityChanges` under one `activity` row.
3. The mutation returns `serialise(result)` with the `activityId`, so the client can offer undo.

Undo (`platform/undo:undo` and `undoRun`) checks that every touched record still holds the values the action left. If a later action changed them, it refuses with `changed_since` and writes nothing. Undoing a create is refused the same way while the record has Checklist Items, Work Blocks, Focus Sessions or links that the undo would not also remove or point back elsewhere (Convert to Project moves them onto a Task it creates, and its undo moves them back). Otherwise undo writes the inverse as a new Activity row. A record the undone actions both created and deleted is skipped. Undo refuses to undo an undo or a Things Import. `undoRun` refuses with `run_active` while the run's Job is claimed and its lease holds, and an Agent Run can act only while its lease holds.

## How a Things Import lands

Until Switch Day, `planner/things:importRows` takes the rows `apps/things-sync/things.sql` reads from a copy of the Things database. Only a Worker with the `things` capability may call it. `docs/leaving-things.md` explains it for Avi.

- `planner/thingsRows.ts` maps the rows to LifeOS fields in one pure function. A repeating template, an impossible date or an unknown status is skipped and reported, never guessed.
- `planner/thingsImport.ts` writes them in batches of 200 per table (Areas, Labels, Projects, Headings, Tasks, Checklist Items), one mutation and one Activity row per batch, so a large Logbook stays inside Convex's limits.
- A new record is inserted with its Things Link and an Order Key after its last sibling, in Things order.
- An existing record is merged field by field. A field takes Things' value only while LifeOS still holds the value in `base`. A field LifeOS changed is kept. A record with a link but no `base` keeps every field. Then `base` becomes what Things has now.
- A record that leaves Things is left exactly as it is. Nothing is deleted.
- An unchanged import records no Activity and changes nothing.
- `planner/things:retire` (Switch Day) sets `retiredAt`. From then on `importRows` and every batch refuse with `retired`, and the Mac app stops importing.

## Decisions

- **Activity rows group changes by action, and actors group actions by run.** Undoing one action reads one group. Undoing a run reads every group for that Job. Both write one undo row, so either undo is itself one step in history.
- **Undo refuses rather than merges.** When a later action touched the same fields, a silent overwrite would lose Avi's later edit. The error names the record, so the UI can say why.
- **A Focus Session is one row with a state, not a row per stretch.** Pausing adds to `pausedMs` and never splits the session, so "only one runs" is one index read and the history shows what Avi did, not how often he paused.
- **Time past a planned length is not Actual Time.** A Pomodoro left running overnight records its 25 minutes, not 14 hours. Extending says "I kept going" on purpose.
- **Work Blocks are removed with a timestamp, not deleted.** Convex cannot re-insert a row with its old id. A hard delete would break undo of every earlier change to that block.
- **Day Plan order lives on the Task.** A Task is planned on one date at a time (its When), so its place in that day is one optional field, not a row in a child table. Moving it writes one document. Tasks without a key for the day sort after the keyed ones, in Today order.
- **Today, This Evening and each Upcoming day share the Day Plan order.** A hand order for a day is the Task's `plan` key for that date, the same key the week Planner writes, so there is no separate `todayOrder`. Tasks without a key for the day sort after the keyed ones: in Today by their Things Today position (`things.todayIndex`), then date, Deadline and Order Key; on an Upcoming day by Order Key. The first drag in a list rekeys the whole day in the order shown, so the Things order holds only until then (#75).
- **Nothing writes to Things.** LifeOS is the home of Avi's Tasks. The two-way bridge and its `things` Jobs were removed on 18 November 2026 (#35).
- **Lease expiry happens at claim time.** `claim` takes expired Jobs as well as queued ones, so no cron is needed and an expired Job is reclaimed the moment a Worker asks.
- **Planner tables are plain folders in the main app, not Convex components.** Components isolate tables, which would block cross-module links and shared Activity (`docs/architecture.md`).
- **A Recurrence Rule catches up with one occurrence, not many.** After an outage the generator walks the missed dates and creates only the latest one inside the end. A week offline gives one "Water the plants", not seven. A missed occurrence still does not count towards `end: after`.
- **Recurrence Rules are never deleted.** Undo cannot re-insert a row under its old id, and every occurrence points at its rule through `repeat.ruleId`. Stopping a rule sets `next` to `ended`.
- **The generator's own changes cannot be undone.** Undoing one would set the rule due again, and the next run would create the same Task. Avi trashes an occurrence instead. The Task still holds the rule and date, so the rule never creates it again. Generation that happens inside `setRepeat` or `skip` belongs to that action and undoes with it.
- **Every public function checks the caller in one place.** `platform/access.ts` builds every public query and mutation, so a new function cannot forget the owner check (#17).
