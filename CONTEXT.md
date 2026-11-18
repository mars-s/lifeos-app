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

**Activity**: the append-only record of every change. It powers undo, visualisations and the Things Bridge.

**Things Bridge**: the two-way link with Things 3 while Avi moves over. It covers only the fields Things can store.

## Authority

- LifeOS (Convex) holds every Task, Area, Project and planning field.
- While the Things Bridge is on, a change made in Things to a field Things owns (title, notes, When, Deadline, Area, Project, Labels, status) updates LifeOS. A change made in LifeOS to those fields is queued and applied to Things by the Mac, then read back.
- Estimates, Work Blocks, Checklist Items, Focus Sessions, Recurrence Rules and Templates live only in LifeOS.
- Apple Calendar holds the timing of External Commitments and, once written back, of Work Blocks.
