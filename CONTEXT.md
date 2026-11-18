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

**Work Block**: a slot on the calendar reserved for one Task, with a start and an end. A Task can have several. Creating one never changes the Task's Deadline.
_Avoid_: timebox in code (fine in UI copy), event.

**External Commitment**: a calendar event LifeOS did not create, read from Apple Calendar. It uses up time but is not a Task.

**Capacity**: free time in a day once External Commitments are taken out. Compared with the sum of Estimates planned for that day.

**Focus Session**: a stretch of timed work on one Task. Its length is the Task's Actual Time.

**Actual Time**: the sum of a Task's Focus Sessions. Compared with its Estimate.

## Rituals

**Brain Dump**: fast, unsorted capture. In the data it is the Inbox.

**Day Plan**: the Tasks Avi commits to for one date, in order, with the day's Capacity.

**Shutdown**: the end-of-day review of a Day Plan: what got done, Actual Time by Area, what rolls to tomorrow.

**Recurrence Rule**: a schedule that creates a fresh Task each time it comes due (every weekday, every 2 weeks on Thursday, the first Thursday of the month).

**Template**: a saved Task shape (title, Estimate, Labels, Checklist Items) used to create new Tasks.

## System

**Activity**: the append-only record of every change. One Activity entry is one action (one edit, one undo, one batch of a Things Import) and holds each change with its value before and after, so it can be inverted. It powers undo and visualisations.

**Undo**: reverting one Activity entry, or every entry of an Agent Run, in one step. Undo is refused when a later change touched the same fields.

**Things Import**: one one-way copy of Avi's Things 3 data into LifeOS, read from a copy of the Things database on the Mac. It runs until Switch Day. It brings in new records and Things-side changes to fields LifeOS has not touched, and never deletes anything. Nothing is ever written to Things.
_Avoid_: Things Bridge, Things sync (except for the `pnpm sync:things` command), snapshot.

**Things Link**: the Things id stored on an imported record, with the field values Things had at the last import (its base). A record without one exists only in LifeOS.

**Switch Day**: the day Avi retires Things (`pnpm things:switch`). One last Things Import runs, then every later import is refused. Things Links stay for reference.

**Order Key**: a fractional index string that places a record among its siblings. Moving a record changes only its own key.

## Platform

**Core**: the hosted Convex deployment. It holds the live app data and the Job queue.

**Home Server**: one thin LXC container on Avi's Proxmox box, on his Tailscale network, with the 2 TB SSD. It runs Workers.

**Module**: one area of the life OS (Planner, Calendar, Notes, Saved Links, Agents). It owns its tables, queries, MCP tools, Job kinds and screens, and shares Areas, entity references, Activity, Labels, search and Jobs with the others.

**Job**: a unit of background work queued in Core, with a lease, retries and a receipt. An Agent Run is one kind of Job.

**Owner**: the one person a LifeOS belongs to, Avi. He signs in with his GitHub account. Every other account is refused.
_Avoid_: admin, user (in code, `users` is only Convex Auth's table).

**Worker**: a process outside Convex that works for Core with its own token (the Things Worker on the Mac, which sends Things Imports until Switch Day; agent and indexing Workers on the Home Server, which claim Jobs). Core keeps only the token's SHA-256 hash and the capabilities the Worker has.

**Lease**: the time a claimed Job belongs to one Worker. The Worker extends it with a heartbeat. When it runs out, the next Worker to claim takes the Job.

**Entity Reference**: one typed pointer (`{ table, id }`) to any linkable record: Task, Project, Area, Heading, Label, Checklist Item, Work Block, and later Note, Saved Link and External Commitment. Links between records use it, so every record can list its **Backlinks**.

**Agent Run**: one execution of an in-app agent. Its changes are recorded in Activity with the run as the actor, so the whole run can be undone.

**Actor**: who made a change: Avi, an Agent Run, or Things (through a Things Import).

**Note**: a local-first document kept on each device and the Home Server, merged with a CRDT. Core holds only its searchable projection.

**Saved Link**: a captured URL, indexed by a Worker, searchable in Core.

## Authority

LifeOS is the home of Avi's Tasks (Avi, 18 November 2026). They live in Convex. Avi is leaving Things 3: it is only a migration source until Switch Day (`docs/leaving-things.md`).

- Every field is editable in LifeOS. The UI never locks a field as "Things owns this".
- Nothing is ever written to Things. LifeOS edits stay in LifeOS.
- **LifeOS wins.** A Things Import never overwrites a field LifeOS has changed since the last import. A change made in Things flows in only when LifeOS has not touched that field.
- A record that leaves Things is never deleted from LifeOS.
- LifeOS alone holds the planning layer: Estimates, Work Blocks, Focus Sessions, Day Plans, Recurrence Rules, Templates, Area and Label colours, and Order Keys.
- Apple Calendar owns the timing of External Commitments and, once written back, of Work Blocks.
