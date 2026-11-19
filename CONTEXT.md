# LifeOS domain language

One person, Avi, plans his life here. These words mean one thing each, in code, issues and UI copy.

## Organising work

**Task**: one thing to do. It has a title, notes, a When, an optional Deadline, an optional Estimate, Labels and Checklist Items.
_Avoid_: to-do (except in UI copy that mirrors Things), item, ticket.

**Checklist Item**: a small step inside a Task. It can be ticked off without completing the Task.
_Avoid_: subtask in code (fine in UI copy).

**Area**: an ongoing responsibility, such as University, Personal or Paperless. It never finishes. It has a colour that tints its Tasks everywhere.
_Avoid_: category, folder.

**Project**: a goal that finishes. It sits inside one Area or stands alone. It can split into Headings.
_Avoid_: list, epic.

**Heading**: a named section inside a Project.

**Label**: a cross-cutting tag such as Deep Work or Admin. A Task can have several. Things tags import as Labels.
_Avoid_: tag in code.

## Time

**When**: where a Task sits in time: Inbox, Anytime, Someday, or a Scheduled date (optionally This Evening). "Today" is a Scheduled date equal to today, or earlier.
_Avoid_: start date, due date.

**Deadline**: the date a Task must be done by. Independent of When and of any Work Block.
_Avoid_: due date.

**Estimate**: how long a Task should take, in minutes. Shown as `0:30`. Also called allocated time in conversation.
_Avoid_: duration (that belongs to Work Blocks).

**Smart Estimate**: an Estimate LifeOS suggests for a Task that has none. It is an AI Capability: the model Avi picked chooses from the Task and his nearest past Tasks, then LifeOS nudges the answer by how far he usually runs over or under. Up to three guesses replace the preset chips on the card, each with its odds, and the most likely one is marked with its reason. A guess becomes the Estimate only when Avi clicks it. When Places knows a Trip, each guess adds the Trip there and back and says so. With AI off, or Smart Estimates switched off on the AI page, nothing is sent anywhere.
_Avoid_: AI estimate, auto-estimate.

**Work Block**: a slot on the calendar reserved for one Task, with a start and an end. A Task can have several. Creating one never changes the Task's Deadline.
_Avoid_: timebox in code (fine in UI copy), event.

**Smart Block**: a window Avi reserves on the Timebox for a kind of work, such as Focus from 4 to 6, with a title, a colour and optionally the Areas, Projects or Labels whose Tasks may fill it (every Task when none are chosen). It can repeat daily, on weekdays, weekly on chosen days, fortnightly or monthly, using the Recurrence Rule schedules. **Filling** it ranks the eligible Tasks (Deadline, Area Priority, the Day Plan, age), sizes each by its Estimate, else its Smart Estimate as a guess, else 30 minutes, and packs them inside the window around busy time, five minutes apart. The fill is previewed as ghost Work Blocks with a reason each, and Enter places them. Those Work Blocks stay put: a later fill only frees the ones whose Task is done, removed or no longer eligible. A repeating Smart Block shows on later days as an empty zone until Avi fills it. Editing one day detaches that occurrence from the series. It is a Feature that Avi can switch off.
_Avoid_: focus zone, frame, time slot (fine in UI copy).

**Area Priority**: Avi's order of Areas for Smart Blocks, set by dragging in the Smart Blocks settings. Higher Areas win when there is room for only some Tasks. A Task without an Area sits in the middle. Until Avi sets it, it follows the sidebar order.

**External Commitment**: a calendar event LifeOS did not create, read from Apple Calendar by the Mac app. One occurrence of a repeating event is one External Commitment. It uses up time but is not a Task. A free event, one Avi declined, or an all-day event not marked busy shows but takes no time.
_Avoid_: event (in code), meeting.

**Calendar**: one Apple Calendar (Work, Home, a holiday subscription). Avi chooses which Calendars count. A Calendar that does not count is hidden and takes no time.

**Working Hours**: the part of each day Capacity counts, 9:00 to 17:30 unless Avi changes it.

**Capacity**: free time inside Working Hours once External Commitments are taken out. Overlapping commitments count once. Compared with the sum of Estimates planned for that day.

**Goal**: how much planned work Avi wants on one date. It defaults to that day's Capacity. He can set it per day (4:00 on a light day, 8:00 on a push) and reset it to the default. The day meter compares the day's load with the Goal and with Capacity.
_Avoid_: target, quota.

**Day Load**: everything planned for one date, in minutes: each Task's Work Blocks on that day, or else its Estimate, or else its Smart Estimate (shown as a guess). Tasks with none of these are counted as "not estimated". Tasks without an Area count like any other, in a neutral tint. An Estimate or Smart Estimate bigger than the day's Goal (or than one four-hour session when the Goal is zero) counts only up to that cap, and the rest shows on the Task as left for other days. Work Blocks always count in full. Upcoming occurrences of a Recurrence Rule that are not made yet count too, as faint ghost rows.

**Spread**: placing the day's Tasks on the Timebox in one step, Sunsama style. Each Task without a Work Block that day gets one, in Day Plan order, in the free gaps inside Working Hours around External Commitments, the Sleep Window and existing Work Blocks, with ten minutes between them. It is previewed as ghost blocks first, and one undo removes the whole Spread. Tasks that do not fit stay unscheduled. Spread never places a Task inside a Smart Block, filled or not: that time is reserved, and Tasks get there by filling the Smart Block.

**Focus Session**: a stretch of timed work on one Task. Only one runs at a time. It can be paused, and paused time does not count. A Stopwatch session counts up until it is stopped. A Pomodoro session has a planned length, then offers a Break.

**Break**: the rest between two Pomodoro Focus Sessions on the same Task. It never counts as Actual Time.

**Actual Time**: the sum of a Task's Focus Sessions, without Breaks, pauses or time past a planned length. Compared with its Estimate.

## Places

**Saved Place**: an address Avi enters on the Places settings page: Home, and optionally Work or Uni. It is geocoded once and kept with its coordinates.
_Avoid_: location (in code), address book.

**Trip**: the nearest place that matches a Task that needs going somewhere ("from Officeworks", "post office"), with its distance and travel time from Home. Avi can pick another branch or dismiss it.
_Avoid_: errand (fine in UI copy), destination.

**Travel Mode**: how a Trip's travel time is worked out: drive, walk or cycle. Public transport is not available.

## Health

**Sleep Window**: the stretch of a night Avi sleeps or plans to, drawn on the Timebox from bedtime to wake. A past night is what Oura recorded. Tonight and later use Oura's bedtime and his usual wake.
_Avoid_: sleep block, sleep event.

**Oura's Bedtime**: the bedtime window Oura recommends (its `optimal_bedtime`). Oura needs several nights before it gives one.

**Usual Wake**: the median time Avi woke over his last 14 recorded nights. Oura does not recommend a wake time, so LifeOS works it out. **Usual Bedtime** is worked out the same way and stands in when Oura has no bedtime yet.

**Health Day**: one day of Oura data (sleep, sleep score, readiness), filed under the morning the night ended.

## Rituals

**Brain Dump**: fast, unsorted capture. In the data it is the Inbox.

**Day Plan**: the Tasks Avi commits to for one date, in order, with the day's Capacity and Goal.

**Shutdown**: the end-of-day review of a Day Plan: what got done, Actual Time by Area, what rolls to tomorrow.

**Recurrence Rule**: a schedule that creates a fresh Task each time it comes due (every weekday, every 2 weeks on Thursday, the last Friday of the month, every year on 29 February). An after-completion rule instead waits until its current Task is completed, then comes due a set number of days, weeks or months later. A rule can end on a date or after a number of occurrences. Each occurrence is its own Task, so editing a rule changes only the occurrences still to come. **Skip** passes over one due occurrence without creating it. Stopping a rule keeps every Task it made.
_Avoid_: recurring task, repeat (as a noun in code, except the `repeat` link on a Task).

**Template**: a saved Task shape (title, notes, Estimate, Labels, parent, Checklist titles, and a Deadline as days after the When) used to create new Tasks. A Task made from a Template, or by a Recurrence Rule, gets its own Checklist Items, so editing it never changes the Template.

## System

**Activity**: the append-only record of every change. One Activity entry is one action (one edit, one undo, one batch of a Things Import) and holds each change with its value before and after, so it can be inverted. It powers undo and visualisations.

**Undo**: reverting one Activity entry, or every entry of an Agent Run, in one step. Undo is refused when a later change touched the same fields.

**Things Import**: one one-way copy of Avi's Things 3 data into LifeOS, read from a copy of the Things database on the Mac. It runs until Switch Day. It brings in new records and Things-side changes to fields LifeOS has not touched, and never deletes anything. Nothing is ever written to Things.
_Avoid_: Things Bridge, Things sync (except for the `pnpm sync:things` command), snapshot.

**Things Link**: the Things id stored on an imported record, with the field values Things had at the last import (its base). A record without one exists only in LifeOS.

**Switch Day**: the day Avi retires Things (`pnpm things:switch`). One last Things Import runs, then every later import is refused. Things Links stay for reference.

**Order Key**: a fractional index string that places a record among its siblings. Moving a record changes only its own key.

## AI

**AI**: the one Feature every AI call goes through. It is off until Avi switches it on, and then it needs at least one Provider key. With AI off, LifeOS sends nothing to any model.
_Avoid_: assistant, chat (there is no chat).

**Provider**: a company or gateway LifeOS sends AI calls to with Avi's key: OpenAI or OpenCode Go. Each has one named secret.
_Avoid_: vendor, backend.

**Model**: one model at one Provider, as LifeOS offers it, such as GPT-6 Luna on the Decisions API or DeepSeek V4.1 Flash on OpenCode Go. It says what it can answer (a choice with odds, or structured JSON) and what it costs.

**AI Capability**: one job AI does in LifeOS, such as Smart Estimates, Break into steps or Trip detection. Each has its own switch and its own Model, picked on the AI page, with a default and a cheap fallback. A new job, such as a task recommender, is a new AI Capability.
_Avoid_: AI feature (a Feature is something else), skill, tool.

**Step Suggestion**: the Checklist Items Break into steps proposes for one Task. Avi edits, reorders and accepts them, and they become Checklist Items in one undoable change.
_Avoid_: AI subtasks.

## Platform

**Core**: the hosted Convex deployment. It holds the live app data and the Job queue.

**Home Server**: one thin LXC container on Avi's Proxmox box, on his Tailscale network, with the 2 TB SSD. It runs Workers.

**Feature**: an optional capability Avi switches on or off in Settings, such as AI, Places or Templates. It has its own settings page, the keys it needs, and the other Features it works better with. It plugs into surfaces that already exist (the Task card, the command bar) and owns no screen of its own. Its code lives in a Module, or in its own Module folder when it brings tables.
_Avoid_: plugin, integration, preference (for a whole capability).

**Feature Status**: what a Feature needs before it works: ready, off, needs a key, needs another Feature (Places needs AI), or needs setup (such as a home address).

**Module**: one area of the life OS (Planner, Calendar, Notes, Saved Links, Agents). It is always there, unlike a Feature. It owns its tables, queries, MCP tools, Job kinds and screens, and shares Areas, entity references, Activity, Labels, search and Jobs with the others.

**Job**: a unit of background work queued in Core, with a lease, retries and a receipt. An Agent Run is one kind of Job.

**Owner**: the one person a LifeOS belongs to, Avi. He signs in with his GitHub account. Every other account is refused.
_Avoid_: admin, user (in code, `users` is only Convex Auth's table).

**Worker**: a process outside Convex that works for Core with its own token (the Mac Worker, registered as `things`, which sends Things Imports until Switch Day and Apple Calendar windows while the Mac app is open; agent and indexing Workers on the Home Server, which claim Jobs). Core keeps only the token's SHA-256 hash and the capabilities the Worker has.

**Lease**: the time a claimed Job belongs to one Worker. The Worker extends it with a heartbeat. When it runs out, the next Worker to claim takes the Job.

**Entity Reference**: one typed pointer (`{ table, id }`) to any linkable record: Task, Project, Area, Heading, Label, Checklist Item, Work Block, and later Note, Saved Link and External Commitment. Links between records use it, so every record can list its **Backlinks**.

**Agent Run**: one execution of an in-app agent. Its changes are recorded in Activity with the run as the actor, so the whole run can be undone.

**Actor**: who made a change: Avi, an Agent Run, Things (through a Things Import), or the Recurrence Rule generator.

**Note**: a local-first document kept on each device and the Home Server, merged with a CRDT. Core holds only its searchable projection.

**Saved Link**: a captured URL, indexed by a Worker, searchable in Core.

## Authority

LifeOS is the home of Avi's Tasks (Avi, 18 November 2026). They live in Convex. Avi is leaving Things 3: it is only a migration source until Switch Day (`docs/leaving-things.md`).

- Every field is editable in LifeOS. The UI never locks a field as "Things owns this".
- Nothing is ever written to Things. LifeOS edits stay in LifeOS.
- **LifeOS wins.** A Things Import never overwrites a field LifeOS has changed since the last import. A change made in Things flows in only when LifeOS has not touched that field.
- A record that leaves Things is never deleted from LifeOS.
- LifeOS alone holds the planning layer: Estimates, Work Blocks, Smart Blocks, Area Priority, Focus Sessions, Day Plans and their Goals, Recurrence Rules, Templates, Area and Label colours, and Order Keys. Smart Blocks are not written to any calendar yet.
- Oura owns Health Days and Oura's Bedtime. LifeOS only reads them and never writes to Oura.
- Apple Calendar owns External Commitments and Calendars. LifeOS only reads them. Which Calendars count and Working Hours belong to LifeOS.
- OpenStreetMap owns the shops and places a Trip points at. LifeOS caches what it found per Task and never writes to OpenStreetMap.
- Apple Calendar will own the timing of Work Blocks once they are written back (not built yet).
