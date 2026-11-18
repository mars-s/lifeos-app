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
| `actor` | `{ kind: "avi" }`, `{ kind: "agentRun", jobId }` or `{ kind: "things" }` |
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
| `entity` | Record reference (any Entity Reference, an `entityLinks` row, or a setting row: `calendars`, `workingHours`) |
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
| `job` | `{ kind: "agent", payload: { request } }`. A new module adds its own kind. |
| `idempotencyKey` | Unique per logical piece of work |
| `status` | `queued { availableAt }`, `claimed { workerId, leaseUntil, heartbeatAt }`, `done { at, receipt }` or `failed { at, error }` |
| `attempts` | Claims so far |

| Index | Serves |
| --- | --- |
| `by_idempotency_key` | Enqueue returns the existing Job for a repeated key |
| `by_kind_status_available` (`job.kind`, `status.kind`, `status.availableAt`) | Claim the oldest queued Job of a kind whose retry delay has passed |
| `by_kind_status_lease` (`job.kind`, `status.kind`, `status.leaseUntil`) | Claim a Job whose lease expired |

`claim` returns the Job with its attempt number. `heartbeat`, `complete` and `fail` must name that attempt, so a stale attempt cannot finish a Job its Worker has claimed again. Each kind sets its own limits in `jobKinds` (`platform/jobs.ts`): `agent` allows 1 attempt with a 15 minute lease. A failed attempt with `retry: true` waits 5 seconds, doubling up to 5 minutes. An expired lease returns the Job to whichever Worker claims next. After the last attempt the Job fails with `lease_expired`.

### `workers`

| Field | Type |
| --- | --- |
| `name` | Unique, such as `things` |
| `capabilities` | What this Worker may do: `agent` (a Job kind it may claim), `things` (send Things Imports) or `calendar` (send Apple Calendar windows) |
| `tokenHash` | SHA-256 hex of the Worker's token. The token itself lives only in that machine's keychain. |

Indexes: `by_name` (register, and `platform/workers:grant`, which adds one capability to a named Worker without touching its token), `by_token_hash` (authenticate every Worker call).

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
| `estimateMinutes` | Optional, 1 to 1440 | LifeOS |
| `parent` | `loose`, `area { areaId }` or `project { projectId, headingId? }` | LifeOS |
| `labelIds` | `Id<"labels">[]` | LifeOS |
| `status` | `open`, `completed { at }` or `canceled { at }` | LifeOS |
| `trashedAt` | Optional moment | LifeOS |
| `order` | Order Key inside its parent | LifeOS |
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

### `areas`

`title`, `colour`, optional `icon`, `order`, optional `trashedAt`, optional `things { id, base? }`. Indexes: `by_things_id`, `by_order` (sidebar), `by_trashed` (`trashedAt`, the Trash list). A new Area from Things takes the colour at its Things position, cycling through the eight tokens.

### `projects`

`title`, `notes`, optional `areaId`, `when`, optional `deadline`, `labelIds`, `status`, optional `trashedAt`, `order`, optional `things { id, base? }`. Indexes: `by_things_id`, `by_area_order` (`areaId`, `order`) for the sidebar and Area page, `by_trashed` (`trashedAt`, the Trash list).

### `headings`

`projectId`, `title`, `order`, optional `things { id, base? }`. Indexes: `by_things_id`, `by_project_order`.

### `labels`

`name`, `colour`, `order`, optional `things { id, base? }`. Indexes: `by_name` (a Things tag links to an unlinked Label of the same name), `by_things_id`, `by_order`. A Task holds its Label ids as an array. Views filter by Label in memory after an index read. A cross-module "everything labelled X" query adds a `labelLinks` table (`labelId`, `entity`) with a `by_label` index, without changing `labelIds`.

### `checklistItems`

`taskId`, `title`, `done`, `order`, optional `things { id, base? }`. Indexes: `by_task_order`, `by_things_id`.

### `workBlocks`

`taskId`, `start` (moment), `minutes`, `timeZone`, `done`, optional `removedAt`. The end is `start + minutes`, so a block cannot end before it starts. Removing sets `removedAt`, so undo restores the same row and earlier actions on it stay undoable.

| Index | Serves |
| --- | --- |
| `by_task_start` (`taskId`, `start`) | The Task card |
| `by_removed_start` (`removedAt`, `start`) | The Timebox calendar for a range |

Apple Calendar write-back adds an optional `calendarEvent { calendarId, eventKey }` field.

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
| `pomodoro` | Optional `{ focusMinutes, breakMinutes }`: the lengths the next step of the cycle uses |
| `removedAt` | Optional moment. Set when a session is removed from a Task's history, so undo restores the same row |

| Index | Serves |
| --- | --- |
| `by_task_start` (`taskId`, `start`) | Actual Time and the history on a Task row |
| `by_start` (`start`) | Analytics and the focus heatmap, later |
| `by_state` (`state.kind`) | The one running or paused session |

The clock is never stored and no server tick runs. `shared/focus.ts` works every figure out from these fields and the current time: focused time is the end (or now) minus `start` minus `pausedMs`, capped at `plannedMinutes`. The web app and the backend share that file (`@lifeos/backend/focus`), so a pill in two tabs and the stored Actual Time always agree. A session whose planned time has run out stays as it is until Avi finishes it, extends it or starts a Break. It gains no more time while it waits.

### `thingsSync`

One row: `syncedAt`, the counts of the last Things Import per table, and `retiredAt` once Switch Day has run. Read by the "Synced from Things" note, which hides after Switch Day.

### `thingsTombstones`

`thingsId`. One row per Things id of a record that was deleted forever. Index: `by_things_id`. A Things Import skips a row whose id is here, so a record Avi deleted for good does not come back before Switch Day.

## Planner view queries

Each screen reads one query that returns exactly what it draws. All go through `ownerQuery`.

| Query | Screen | Reads |
| --- | --- | --- |
| `planner/sidebar:get` (`date`) | The sidebar: Inbox and Today counts, Areas in order, each with its open Projects and their progress | `tasks.by_trashed_status_when`, `areas.by_order`, `projects.by_area_order`, `tasks.by_project_order` |
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
| `planner/trash:list` | Trash: trashed Areas, Projects and Tasks, newest first. A record that went to Trash with its Area or Project is counted on that row, not listed again | `tasks.by_trashed_closed_at`, `projects.by_trashed`, `areas.by_trashed` |

Every list row has the same shape (`enrich` in `planner/rows.ts`): the Task, plus its Area (title and colour), its Project, its Labels, its Checklist Items (with their Order Keys), its Work Blocks that are not removed, and `focus`: its Actual Time in milliseconds and its 12 newest Focus Sessions. A session shorter than a minute is left out of both. A Task card opens from the row it already has, with no second read.

The card writes through `planner/tasks` (`rename`, `setNotes`, `setWhen`, `setDeadline`, `setEstimate`, `setLabels`), `planner/checklist` (`add`, `edit`, `tick`, `reorder`, `remove`) and `planner/labels` (`create`, `setColour`, `rename`, `remove`). `tasks:reorder` sets one Task's Order Key, for drag to reorder. `labels:rename` refuses a name another Label holds (`name_taken`). `labels:remove` takes the Label off every open Task and deletes it. It cannot be undone, because undo cannot bring a record back under its old id. `labels:create` takes an optional `taskId` and adds the new Label to that Task in the same action, so one undo removes both. A Label name is used once, ignoring case: creating it again returns the Label that exists.

Focus Sessions change through `planner/focus`. `start` (`taskId`, `plan`) ends whatever session is active and starts one on the Task, in one Activity row, so one undo brings the old session back. Starting on the Task already in focus changes nothing. `pause` and `resume` are safe to repeat. `stop` ends the session. `extend` adds minutes to a planned session and forgives the time that ran past the plan. `advance` moves a Pomodoro from focus to its Break and back. `setPlan` switches a running session between Stopwatch and Pomodoro. `setMinutes` and `remove` edit a finished session, because every field is editable. Only an open, live Task can start a session (`invalid_focus`, reason `task_closed`). Completing or trashing the Task, alone, in a selection or with its Project or Area, ends its session in the same Activity row. `planner/focus:current` returns the active session with its Task title and Area colour, or `null`.

A selection of Tasks changes through `planner/selection` (`setWhen`, `setDeadline`, `setEstimate`, `setLabel`, `move`, `complete`, `reopen`, `trash`, `restore`). Each takes `taskIds` (up to 500), validates the whole request first, and records one Activity row, so one undo reverts every Task. A missing Task or an invalid value changes nothing.

Areas change through `planner/areas` (`create`, `rename`, `setColour`, `setIcon`, `reorder`, `trash`, `restore`) and Projects through `planner/projects` (`create`, `rename`, `setNotes`, `setWhen`, `setDeadline`, `move`, `complete`, `reopen`, `trash`, `restore`). A new Area takes the first colour no live Area uses. An icon is a kebab-case name from the web icon set. Trashing an Area or a Project also trashes its live Projects and Tasks with the same `trashedAt`, in the same Activity row. Restore (or undo) brings back only the records that share that moment, so a Task trashed earlier stays in Trash. Completing a Project completes its open Tasks with the Project's completion moment, and reopening it reopens only those.

Trash changes through `planner/trash` (`restore`, `deleteForever`, `empty`). `restore` takes a mixed list of Tasks, Projects and Areas and records one Activity row. A Task put back while its Project or Area is still in Trash moves to the nearest live parent (the Project's Area, or no parent). `deleteForever` removes a trashed record with its Checklist Items, Work Blocks, Headings and links. What was trashed with a Project or Area goes with it, and anything put back since is kept and moved out. `empty` deletes one batch of 100 per call and returns `done`, so the client calls it until Trash is clear. Both refuse a record that is not in Trash (`not_trashed`), and undo refuses both (`not_undoable`, reason `permanent`).

`planner/seed.test-utils.ts` builds a realistic planner (five Areas, six Projects, Headings, Deadlines, a Logbook). The list tests use it, and a scratch local backend can run it for visual checks.

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

## Tables later slices add

Each slice adds these as new tables, or as variants of `vEntityRef` and `vJob`. None reshapes a table above.

### Calendar write-back

- Writing Work Blocks to Apple Calendar adds an optional `calendarEvent { calendarId, eventKey }` to `workBlocks`, and a Mac-side writer that only changes events LifeOS created.

### Rituals

- **`dayPlans`**: `date`, `capacityMinutes`, optional `shutdown { at, note }`. Index: `by_date`.
- **`dayPlanEntries`**: `dayPlanId`, `taskId`, `order`. Indexes: `by_plan_order` (the day column), `by_task` (which days a Task was planned on). A child table, because a plan's Task list has no fixed bound.

### Recurrence and templates

- **`templates`**: `title`, optional `estimateMinutes`, `labelIds`, optional `parent`, `checklist` (array of titles, bounded by the template form). Index: `by_order`.
- **`recurrenceRules`**: `rule` (`daily`, `weekdays`, `weekly { days }`, `everyNWeeks { n, day }`, `monthlyNthWeekday { n, day }`), `templateId`, `nextDue`, optional `lastGenerated`. Index: `by_next_due` for the scheduled generator. Generated Tasks are keyed by rule and date (an idempotency key), so a rerun creates nothing twice.

### Notes projection

- **`notes`**: `docId` (the CRDT document id on the peers), `title`, optional `areaId`, `excerpt`, `embedding`, `updatedAt`. Indexes: `by_doc` (the Home Server upserts by document), `by_area_updated`. Search index on `title` and `excerpt`. Vector index on `embedding`, filtered by `areaId`. The documents themselves stay on the peers.

### Saved Links

- **`savedLinks`**: `url`, `title`, optional `summary`, optional `areaId`, `labelIds`, optional `embedding`, `status` (`captured`, `indexed`, `failed`), `capturedAt`. Indexes: `by_url` (no duplicates), `by_captured` (newest first). Search and vector indexes as for Notes. Indexing is an `index:link` Job.

### Agents

- An **Agent Run** is a Job of kind `agent`. Its changes carry the actor `{ kind: "agentRun", jobId }`, and `platform/undo:undoRun` reverts the whole run.
- **`agentMessages`**: `jobId`, `role`, `content` (structured, for generative UI), `at`. Index: `by_run_at`. Added with the first conversational agent.

### Search

One search across modules: a search index on `title` for `tasks` and `projects`, and the Notes and Saved Links search indexes above, merged by one query in the Platform module.

## How a change flows

1. A public mutation built with `changeMutation` (`platform/change.ts`) resolves the actor. With no `agentRun` argument the actor is Avi. With `agentRun: { token, jobId }` it must be a claimed `agent` Job held by that Worker.
2. The handler validates its input and returns a `Result`. It writes only through the recorder (`platform/activity.ts`), which records each insert, patch and delete in `activityChanges` under one `activity` row.
3. The mutation returns `serialise(result)` with the `activityId`, so the client can offer undo.

Undo (`platform/undo:undo` and `undoRun`) checks that every touched record still holds the values the action left. If a later action changed them, it refuses with `changed_since` and writes nothing. Undoing a create is refused the same way while the record has Checklist Items, Work Blocks, Focus Sessions or links that the undo would not also remove. Otherwise undo writes the inverse as a new Activity row. A record the undone actions both created and deleted is skipped. Undo refuses to undo an undo or a Things Import. `undoRun` refuses with `run_active` while the run's Job is still claimed, and an Agent Run can act only while its lease holds.

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
- **Today order starts from Things.** An imported Task sorts by its Things Today position (`things.todayIndex`), then the rest by date, Deadline and Order Key. A LifeOS overlay key for Today (`todayOrder`) arrives with drag to reorder.
- **Nothing writes to Things.** LifeOS is the home of Avi's Tasks. The two-way bridge and its `things` Jobs were removed on 18 November 2026 (#35).
- **Lease expiry happens at claim time.** `claim` takes expired Jobs as well as queued ones, so no cron is needed and an expired Job is reclaimed the moment a Worker asks.
- **Planner tables are plain folders in the main app, not Convex components.** Components isolate tables, which would block cross-module links and shared Activity (`docs/architecture.md`).
- **Every public function checks the caller in one place.** `platform/access.ts` builds every public query and mutation, so a new function cannot forget the owner check (#17).
