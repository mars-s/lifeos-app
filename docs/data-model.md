# LifeOS data model

This page describes every table the life OS needs: the ones built now and the ones later slices add. The schema in `packages/backend/convex/schema.ts` is the source of truth. It composes one `tables.ts` per module, so this page follows the same split. Words in **bold** are defined in `CONTEXT.md`.

Each index name lists its fields. Convex appends `_creationTime` to every index, so rows with equal keys come back in creation order.

## Conventions

- **Dates a person picks** (When, Deadline, Day Plan) are local calendar dates stored as `YYYY-MM-DD` strings and parsed with `parseIsoDate` at every boundary. **Moments** (Work Blocks, Focus Sessions, completion and trash times) are epoch milliseconds.
- **Order Keys** are fractional index strings from `fractional-indexing`. A drag writes one document. Keys sort as plain strings.
- **Status and placement are tagged unions**, never loose optional fields. A Task cannot be "completed" without a completion time, and a Heading cannot be set without its Project.
- **Things Links** are an optional `things` object on a mirrored record. The Things Bridge writes it without recording Activity, because it is bookkeeping, not a change Avi made.
- **Colours** are one of the eight design tokens: `violet`, `green`, `orange`, `teal`, `rose`, `olive`, `plum`, `slate` (`docs/design/system.md`).
- **Trash is a time, not a status.** `trashedAt` sits beside `status`, because Things keeps a trashed Task's status and restores it unchanged.
- Absent optional fields are missing, never `null`. Activity stores a missing field as `null`, because a stored record cannot hold `undefined`.

## Platform module (`convex/platform`)

Shared primitives every module uses.

### `activity`

One row per action: one mutation call, one undo, or one Things snapshot.

| Field | Type |
| --- | --- |
| `actor` | `{ kind: "avi" }`, `{ kind: "agentRun", jobId }` or `{ kind: "things" }` |
| `action` | Action name, such as `task.rename` or `things.snapshot` |
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
| `entity` | Record reference (any Entity Reference, or an `entityLinks` row) |
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
| `job` | `{ kind: "things", payload: { op, entity, thingsId?, set } }` or `{ kind: "agent", payload: { request } }` |
| `idempotencyKey` | Unique per logical piece of work |
| `status` | `queued { availableAt }`, `claimed { workerId, leaseUntil, heartbeatAt }`, `done { at, receipt }` or `failed { at, error }` |
| `attempts` | Claims so far |

| Index | Serves |
| --- | --- |
| `by_idempotency_key` | Enqueue returns the existing Job for a repeated key |
| `by_kind_status_available` (`job.kind`, `status.kind`, `status.availableAt`) | Claim the oldest queued Job of a kind whose retry delay has passed |
| `by_kind_status_lease` (`job.kind`, `status.kind`, `status.leaseUntil`) | Claim a Job whose lease expired |

`claim` returns the Job with its attempt number. `heartbeat`, `complete` and `fail` must name that attempt, so a stale attempt cannot finish a Job its Worker has claimed again. Each kind sets its own limits in `jobKinds` (`platform/jobs.ts`): `things` allows 5 attempts with a 60 second lease, `agent` allows 1 attempt with a 15 minute lease. A failed attempt with `retry: true` waits 5 seconds, doubling up to 5 minutes. An expired lease returns the Job to whichever Worker claims next. After the last attempt the Job fails with `lease_expired`.

### `workers`

| Field | Type |
| --- | --- |
| `name` | Unique, such as `things` |
| `capabilities` | Job kinds this Worker may claim |
| `tokenHash` | SHA-256 hex of the Worker's token. The token itself lives only in that machine's keychain. |

Indexes: `by_name` (register), `by_token_hash` (authenticate every Worker call).

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
| `title`, `notes` | string | Things |
| `when` | `inbox`, `anytime`, `someday`, or `scheduled { date, evening }` | Things (LifeOS keeps `evening`, which Things scripting cannot read) |
| `deadline` | Optional local date | Things |
| `estimateMinutes` | Optional, 1 to 1440 | LifeOS |
| `parent` | `loose`, `area { areaId }` or `project { projectId, headingId? }` | Things (LifeOS keeps `headingId`) |
| `labelIds` | `Id<"labels">[]` | Things (tags) |
| `status` | `open`, `completed { at }` or `canceled { at }` | Things |
| `trashedAt` | Optional moment | Things |
| `order` | Order Key inside its parent | LifeOS |
| `things` | Optional `{ id, list, index, modifiedAt }`: the Things id, the Things list it sits in and its position there | Things Bridge |

| Index | Serves |
| --- | --- |
| `by_things_id` (`things.id`) | Inbound sync lookup |
| `by_trashed_status_when` (`trashedAt`, `status.kind`, `when.kind`, `when.date`) | Today (open, untrashed, scheduled on or before a date). Inbox, Anytime and Someday (one When kind each). Upcoming (scheduled after today, inside a window). The sidebar counts. Inbound departures (all open, untrashed Tasks). |
| `by_trashed_status_deadline` (`trashedAt`, `status.kind`, `deadline`) | Today (due on or before a date). Upcoming Deadlines (due after today, inside a window). |
| `by_trashed_closed_at` (`trashedAt`, `status.at`) | The Logbook: completed and canceled Tasks, newest first, paginated, and narrowed to a range of moments. Open Tasks have no `status.at`, so a lower bound of 0 leaves them out. |
| `by_project_order` (`parent.projectId`, `order`) | Project page. The last key when appending. |
| `by_area_order` (`parent.areaId`, `order`) | Area page. The last key when appending. |
| `by_parent_kind_order` (`parent.kind`, `order`) | Loose Tasks in order. The last key when appending. |

### `areas`

`title`, `colour`, optional `icon`, `order`, optional `trashedAt`, optional `things { id, index }`. Indexes: `by_things_id`, `by_order` (sidebar). A new Area from Things takes the colour at its Things position, cycling through the eight tokens.

### `projects`

`title`, `notes`, optional `areaId`, `when`, optional `deadline`, `labelIds`, `status`, optional `trashedAt`, `order`, optional `things { id, index }`. Indexes: `by_things_id`, `by_area_order` (`areaId`, `order`) for the sidebar and Area page.

### `headings`

`projectId`, `title`, `order`, optional `things { id }`. Index: `by_project_order`. Things scripting does not expose Headings, so none are mirrored yet.

### `labels`

`name`, `colour`, `order`. Indexes: `by_name` (tags map to Labels by name), `by_order`. A Task holds its Label ids as an array. Views filter by Label in memory after an index read. A cross-module "everything labelled X" query adds a `labelLinks` table (`labelId`, `entity`) with a `by_label` index, without changing `labelIds`.

### `checklistItems`

`taskId`, `title`, `done`, `order`. Index: `by_task_order`. LifeOS only. Things checklists are not read.

### `workBlocks`

`taskId`, `start` (moment), `minutes`, `timeZone`, `done`, optional `removedAt`. The end is `start + minutes`, so a block cannot end before it starts. Removing sets `removedAt`, so undo restores the same row and earlier actions on it stay undoable.

| Index | Serves |
| --- | --- |
| `by_task_start` (`taskId`, `start`) | The Task card |
| `by_removed_start` (`removedAt`, `start`) | The Timebox calendar for a range |

Apple Calendar write-back adds an optional `calendarEvent { calendarId, eventId }` field.

### `thingsSync`

One row: `syncedAt` and the counts of the last snapshot. Read by the "Synced from Things" note.

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

Every list row has the same shape (`enrich` in `planner/rows.ts`): the Task, plus its Area (title and colour), its Project, its Labels and its Checklist Items. A Task card opens from the row it already has, with no second read.

`planner/seed.test-utils.ts` builds a realistic planner (five Areas, six Projects, Headings, Deadlines, a Logbook). The list tests use it, and a scratch local backend can run it for visual checks.

## Tables later slices add

Each slice adds these as new tables, or as variants of `vEntityRef` and `vJob`. None reshapes a table above.

### Calendar module

- **`externalCommitments`**: `calendarId`, `eventId`, `title`, `start`, `end`, `allDay`, `source` (calendar name). Indexes: `by_event` (`calendarId`, `eventId`) for the mirror, `by_start` for a range. Written by a Worker reading Apple Calendar through a `calendar` Job kind.

### Focus and rituals

- **`focusSessions`**: optional `taskId`, `start`, optional `end`, `plannedMinutes`, `kind` (`focus` or `break`). Indexes: `by_task_start` (Actual Time per Task), `by_start` (analytics, the focus heatmap).
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
3. When the action changed a field listed in `thingsOwnedFields` (`planner/tables.ts`) and the actor is not Things, the recorder enqueues one `things` Job per record, keyed `things:<activityId>:<recordId>`, carrying only the changed Things-owned fields.
4. The mutation returns `serialise(result)` with the `activityId`, so the client can offer undo.

Undo (`platform/undo:undo` and `undoRun`) checks that every touched record still holds the values the action left. If a later action changed them, it refuses with `changed_since` and writes nothing. Undoing a create is refused the same way while the record has Checklist Items, Work Blocks or links that the undo would not also remove. Otherwise undo writes the inverse as a new Activity row, which queues the inverse Things Operation too. A record the undone actions both created and deleted is skipped. Undo refuses to undo an undo or a Things snapshot. `undoRun` refuses with `run_active` while the run's Job is still claimed, and an Agent Run can act only while its lease holds.

## How a Things snapshot lands

`planner/things:sync` takes a snapshot from the Things Worker (token checked against `workers`, capability `things`).

- A snapshot with an invalid date is refused. A snapshot with no Areas and no Tasks is refused when the last one had some, so a Things hiccup cannot complete the whole mirror.
- Linked records get only their Things-owned fields patched. Estimates, Checklist Items, Work Blocks, Order Keys, colours and the This Evening flag (while the date is unchanged) survive.
- A linked open Task or Project leaves Things when it is missing from the snapshot or sits in the snapshot's `trash` list. It moves to Trash when its id is in `trash`, and is completed otherwise. Things scripting does not say whether a Task that left was completed or canceled, so it is recorded as completed. An Area missing from the snapshot moves to Trash. Nothing is deleted.
- A record that comes back to Things is restored by the next snapshot.
- Changes are recorded as one Activity row with the actor Things, and queue no Things Operations. An unchanged snapshot records nothing.

## Decisions

- **Activity rows group changes by action, and actors group actions by run.** Undoing one action reads one group. Undoing a run reads every group for that Job. Both write one undo row, so either undo is itself one step in history.
- **Undo refuses rather than merges.** When a later action touched the same fields, a silent overwrite would lose Avi's later edit. The error names the record, so the UI can say why.
- **Work Blocks are removed with a timestamp, not deleted.** Convex cannot re-insert a row with its old id. A hard delete would break undo of every earlier change to that block.
- **Today order comes from Things.** A Task in Things' Today list sorts by its Things position (`things.index`), then the rest by date, Deadline and Order Key. A LifeOS overlay key for Today (`todayOrder`) arrives with drag to reorder.
- **Queued Things Operations wait for the outbound Worker.** Nothing applies them yet. A Things snapshot can overwrite the field first, so the Worker must read the record's current values when it claims a Job, not trust `set`, and must fail Jobs queued before it shipped.
- **Lease expiry happens at claim time.** `claim` takes expired Jobs as well as queued ones, so no cron is needed and an expired Job is reclaimed the moment a Worker asks.
- **Planner tables are plain folders in the main app, not Convex components.** Components isolate tables, which would block cross-module links and shared Activity (`docs/architecture.md`).
- **Every public function checks the caller in one place.** `platform/access.ts` builds every public query and mutation, so a new function cannot forget the owner check (#17).
