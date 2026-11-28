# Timeline Planner design

The design for a timeline view of the Planner: a day view on iPhone, the Timebox pane on web and Mac, and a week view on both. Avi approved it on 28 November 2026 ("make sure it's like Exoplan: the curves are on the left and the events are normal"), and it is being built: see Built below. The live specimen is the Waku route `/design/timeline` in `apps/web` (run `pnpm dev:web`, open `/design/timeline`). It uses sample data, and the blocks can be kept, ticked and dragged. The shared look is in [system.md](system.md). The plan is tracked in issue #88.

Avi's request, 28 November 2026: bring in something like [Exoplan's day view](references/exoplan/01-exoplan-day.png) for the Planner on the phone, on web and Mac, plus a week view. Predicted blocks are hollow and slashed, today's are filled and coloured, past ones are grey.

## Direction

1. **Time is the page.** A day reads top to bottom along one ruled line. A block is as tall as it is long, and the gaps are named.
2. **Three inks.** Hatched pencil for what LifeOS predicts, the Area colour for what Avi kept, graphite for what has passed.
3. **Only now moves.** The line fills in as the day goes. Nothing glows, pulses or counts. A block changes ink once, when it is kept or when now passes it.

From Exoplan it takes the time rail, blocks sized by their length, labelled gaps, travel folded into a block, and a week strip with the day's ring. It leaves the glow, the bending line, the dark glass and the icons on blocks. From LifeOS it takes warm paper and graphite, Geist Mono for every time, the rule that one dot is 15 minutes, Area colours, and the Capacity dots from the widgets.

## What "predicted" means

A predicted block is where LifeOS expects a Task to land. It is the Spread and the Smart Block fill, run all the time and not only when Avi asks.

- **Which Tasks.** Open Tasks whose When is that day and that have no Work Block that day, in Day Plan order. A filled Smart Block predicts the Tasks that would fill it.
- **How long.** The Estimate, else the Smart Estimate (shown with `~`), else 30 minutes.
- **Where.** In the free gaps inside Working Hours, after now, around External Commitments, the Sleep Window and kept Work Blocks, ten minutes apart. A Task with a Trip reserves the drive there and back.
- **When it does not fit.** The Task stays in the day's list with no block, as it does after a Spread today.

**It needs no new field.** A prediction is worked out, never saved. `spreadDay` in `packages/backend/shared/spread.ts` and the Smart Block fill already do the placing. A kept block is a `workBlocks` row, exactly as now. What it needs is one query, so that every surface draws the same predictions:

| Need | What it is |
| --- | --- |
| `planner/timeline` query | For a range of dates: Work Blocks, External Commitments, predictions, each Trip's travel minutes, Capacity and Day Load. The iPhone app, the widgets and the MCP connector read it. The web app can keep working it out on the client for speed, with the same function |
| Keep | `planner/workBlocks:create` with the predicted start and minutes. One Activity entry, one undo |
| Keep all | The mutation Spread already uses. One Activity entry for the day |
| A switch | "Predict my days" beside the Smart Blocks settings, on by default |

Because a prediction is not saved, it moves when the day changes: a new External Commitment pushes it later, a kept block takes its place. It is never drawn in the past. When now reaches a prediction it steps to the next free gap, and at the end of the day a Task that was never kept has no block at all.

Keeping a prediction:

| Surface | How |
| --- | --- |
| iPhone | Tap the hatched block. Drag it to keep it at another time. Keep all in the header |
| Web and Mac | Click it, or focus it and press Enter. Drag it. Arrow keys move it by 15 minutes and keep it. Keep all is Cmd+Enter |
| Not today | Backspace, or swipe left on iPhone, changes the Task's When. The prediction goes with it |

## The states

Shot: `timeline-states.png`.

A block is drawn from two facts: has Avi kept it, and has now passed its end.

| State | Looks like | Is |
| --- | --- | --- |
| Predicted | Hollow, hatched at 135 degrees in the Area colour, with an Area-coloured outline. The title sits on a paper label so it reads over the hatching. No box | A prediction. Later today or on a coming day |
| Kept | Filled with the Area colour at 30%, with a box to tick | A Work Block that is not over |
| Past, done | Graphite fill, a filled tick, a struck title | A Work Block that is over, with its Task or the block done |
| Past, not done | A graphite outline, an open box, and "Not done" | A Work Block that is over and not done. No red: the day's header offers to move it |
| External Commitment | A plain outlined card on paper, with the Calendar's dot. No box, never hatched, never filled | An Apple Calendar event. In the past its text and dot fade |
| With a Trip | The drive there and back are lighter bands above and below the Task's own time, split by a dashed rule, with "leave by" | A Work Block or prediction whose Task has a Trip |

Each state reads without colour: by its fill (hatched, solid, flat, none), its box (none, open, ticked) and its title (plain or struck). A block ticked before its time keeps its colour and gains the tick and the struck title. It turns graphite when now passes it.

A block of 20 minutes or less keeps one line: the box, the title and the start time.

## The rail

- A column of dots down the left. One dot is 15 minutes, and the dot on the hour is larger. Hour labels sit beside it in Geist Mono.
- Behind now the dots join into a solid graphite line. The bead at now is the one blue thing on the page, with the time in a pill where the hour label would be, and a hairline across the blocks.
- Gaps after now are named: **Buffer** under 30 minutes, **Free** from 30 minutes, each with its length. Gaps in the past are left blank.

## Energy

Shots: `timeline-energy.png`, and the rail in every day and week shot. Added 28 November 2026, after Avi asked for the energy levels from the Exoplan shot, predicted from his Oura ring.

The rail carries an estimate of Avi's energy through the day. It is a thin lane between the hour labels and the blocks. The line leans away from the dots when energy is high and back towards them when it is low, so the day has a shape you can read at a glance: a rise after waking, a peak late in the morning, a dip after lunch, a second wind, and a wind down towards Oura's bedtime. One graphite ink, no green and red.

| Day | Looks like | Comes from |
| --- | --- | --- |
| Today | A solid line. The area behind now is filled, so the rail still fills in as the day goes. The blue bead for now rides on the line | Last night's real sleep |
| Coming days | A thin line over a hatched area, the same hatching as a predicted block | His usual pattern only |
| Past days | A flat graphite area with a faint line | The estimate that day started with |
| No curve | The plain dot rail | No Oura, or fewer than five nights |

A filled dot marks the peak and a hollow dot marks the dip. A soft band in the Sleep Window colour marks the half hour before Oura's bedtime. In the week view the shared rail carries today's curve, and each day's header has a small curve in its own ink (a dashed outline for coming days), so a short night shows as a low day.

**How it helps planning.**

- Predictions are placed by energy. Among the Tasks for a day, the ones that need focus (the Deep Work Label, or an Estimate of an hour or more) go into the peak first. Short Tasks, Admin and Trips go into the dip. A block placed this way says so: "at your peak".
- A Free gap of 30 minutes or more says what it is good for: "peak, good for deep work" or "dip, good for admin or a walk".
- On a short night the header says "Low energy day" once, and predictions leave more Buffer. Nothing is cancelled for him.
- Energy never moves a kept block and never overrides a Deadline, the Day Plan order within the same kind of Task, or an External Commitment.

**The reading.** A tap on the rail opens a small card: Energy, marked Estimate, with last night's sleep, readiness, sleep debt over 14 nights, and the peak and dip windows. Its last line is always the limits.

**States.**

| State | What Avi sees |
| --- | --- |
| A good night | The full curve, solid |
| A short night | The whole curve sits lower and the dip comes earlier. "Low energy day" in the header |
| Stale (no sync since last night) | Today falls back to the usual pattern, hatched, and the card says "Oura last synced yesterday at 6:10 pm" |
| Learning (fewer than five nights) | No curve. The card says "Learning your pattern, 3 of 5 nights" |
| No Oura, or Health off | The plain dot rail. Nothing about energy anywhere |

**The data.** Everything the first version needs is already synced by the `health` module every four hours: each night's sleep period (start, end, minutes asleep), the sleep score, the readiness score, Oura's bedtime, and the Usual Wake LifeOS already works out. No new Oura scope. The likely model is the two-process one: sleep pressure that builds from the time he woke, plus a daily rhythm anchored on his Usual Wake, scaled by sleep debt over the last 14 nights and by the day's readiness. The build researches and tests it. The curve on the specimen is a stand-in with the right shape. The curve is worked out, not saved, like a prediction. A new domain word is needed in `CONTEXT.md`: **Energy Curve**.

**What it can claim, and what it cannot.**

- It can say: given when you slept and woke, this is when most people with that night are sharpest and when they dip. It is always labelled an estimate.
- It cannot say how Avi feels. It does not see caffeine, food, exercise, illness, naps or stress. It is not measured from heart rate or HRV (that would need Avi to reconnect Oura with more scopes, and is not planned).
- It shows no number and no score. A percentage would look like a measurement.
- The band before bedtime is labelled "Oura's bedtime", not a melatonin window. LifeOS cannot know when his melatonin rises.
- "How the day actually went" is not drawn yet. Later, a past day could lay Focus Sessions and Actual Time beside its curve, which would also let LifeOS check the model against him.

## iPhone

Shots: `timeline-iphone.png`, `timeline-day-iphone-yesterday.png`, `-today`, `-tomorrow`, `timeline-week-iphone.png`, each with `-dark`.

The timeline is the second face of the Today tab. A glass button in the title row switches between the list and the timeline, and the choice is remembered. The tabs (Today, Upcoming, Lists, Notes) and the Liquid Glass bars do not change.

- **Title row.** The day's name (Yesterday, Today, Tomorrow, or the weekday), the date, the list switch and the Capacity ring.
- **Capacity ring.** One dot is 15 minutes of the day's Capacity. Grey dots are done, solid dots are kept, hollow dots are predicted, faint dots are free. The figure is the time left, as h:mm.
- **Week strip.** Seven days. The chosen day is a filled disc, today is blue, past days are muted. Under each date a few dots show the day's load in the same three inks. A tap moves to that day.
- **Summary row.** Today and coming days: "2 predicted later, 1:00" and Keep all. Past days: "4 done, 1 not done" and Move to today.
- **Timeline.** Opens with now a third of the way down. It scrolls under the bars.
- **+ button.** Floats above the search button and opens quick capture. A long press on a Free gap adds a Task at that time.
- **Tick.** The box on a kept block completes the Task in place.

**Week.** Pull the week strip down. Seven narrow columns of shapes with no words, from 8 am to the end of Working Hours, with each day's planned time under its date and a small key at the foot. A tap on a column opens that day. Turning the phone sideways shows the desktop week with titles.

## Web and Mac

Shots: `timeline-desktop.png`, `timeline-week-desktop.png`, each with `-dark`.

**Day.** The Brain Dump and the day columns stay as they are. The Timebox pane becomes the timeline: the dotted rail, the three states, named gaps, Trips folded in. A line under the pane's title counts the predictions and offers Keep all. This replaces the Spread button and its preview: the preview is now always there. Each Task card in a day column shows a small swatch in the ink of its block beside its time (hatched, filled or graphite).

**Week.** The Week switch gives the pane the room of the day columns. The Brain Dump stays, so a thought can still be dragged onto any day. Each column has its weekday, its Capacity dots (one dot is 30 minutes) and the time left. Monday and Tuesday are graphite, today has a faint ground and the now line, and the coming days are hatched where LifeOS predicts. An empty day says "Nothing planned".

## Motion

Shot: `timeline-motion.png`. Both demos on the specimen are live.

| Moment | Motion |
| --- | --- |
| Keep | The hatch lines thicken until they meet, 360 ms ease-out, and the box fades in. One light haptic on iPhone |
| Drag | The block lifts 1.5% with a shadow and a time readout, snaps to 15 minutes, and settles in 220 ms. Dropping a prediction keeps it |
| Into the past | As now passes a block's end, its colour drains to graphite over 360 ms |
| Now | The bead and the line step once a minute and ease 360 ms. The rail behind the bead joins up |
| Reduced motion | Hatch and colour cross-fade in 160 ms. Nothing lifts, scales or slides |

The hatch is one `repeating-linear-gradient` whose line width is a registered custom property (`--tl-hatch`), so predicted, kept and past are the same element and the change between them is one transition. On iPhone the same idea is a Reanimated shared value driving the line width of a Skia path.

## Checked against

- **Sunsama and Ellie.** The Brain Dump, day columns and Timebox keep their places. Done blocks fade and strike through, as in Ellie's week.
- **Things.** Calendar events stay quiet and separate from Tasks. The open box and the tick are the Things box.
- **Sleep Window.** The band before bedtime uses the Sleep Window colour, and the curve stops where the Sleep Window starts.
- **Widgets.** The same dots (one is 15 minutes), the same solid bar for a Work Block and outline for an External Commitment. The widgets' day strip should draw predictions hatched once this ships. The widgets draw a Trip as a dashed line, and here it is a band with a dashed rule.

## Shots

Taken by `apps/web/scripts/check-timeline-design.py` at 1440 px and double density, plus Today at 390 px. The script also checks keeping, Keep all, ticking, the Day and Week switch, dragging, and moving now.

## Build slices

1. The `planner/timeline` query, with tests beside it
2. Web and Mac: the Timebox pane draws the rail and the three states, with Keep and Keep all
3. Web and Mac: the week view
4. iPhone: the day view on the Today tab, with the week strip, the Capacity ring and the + button
5. iPhone: the week view, and the sideways week
6. Trips folded into blocks, with the drive reserved by the prediction
7. Widgets: the day strip draws predictions hatched
8. The Energy Curve: a pure function in `convex/health` from sleep periods, Usual Wake, sleep debt and readiness, with tests against known nights; the `planner/timeline` query returns it per day; the rail, the week headers and the reading card draw it; then predictions and gap hints use it

## Decided

1. **Earlier today.** A block turns graphite once now passes it: grey above the now line, colour below.
2. **How far ahead to predict.** Today and tomorrow only. Later days show only what is kept.
3. **Where it lives on iPhone.** A second face of the Today tab.

The Energy Curve lives only in the left rail, beside the dots. The blocks keep their normal widths and look.

## Built

- **Core.** `planner/timeline:days` returns each day's Work Blocks, External Commitments, predictions, Capacity, load in three inks and Energy Curve. `predictDay` in `packages/backend/shared/timeline.ts` places the predictions, and the web app runs the same function on the client so a keep or a drag answers in the same frame.
- **Web and Mac day.** The Timebox pane (`components/lifeos/timebox.tsx`) draws the dotted rail, the solid line up to now, the Energy Curve (`components/lifeos/energy-curve.tsx`), the now bead and pill, the three inks, outlined External Commitments, Trips as drive bands with "leave by", and Buffer and Free gaps with the energy hint. A prediction is kept by a click, Enter, a drag or the arrow keys, and Keep all is Cmd+Enter or the button under the title; each keep is one undoable change. A block keeps its React key when it is kept, so the hatch thickens into the fill. The Spread command keeps all on today and tomorrow and still previews on later days. `apps/web/scripts/check-timeline.py` checks it (shots: `timeline-app-*.png`).
- **Web and Mac week.** The Week switch gives the pane the room of the day columns, with the shared rail carrying today's curve. Each day's header has its Capacity dots (one dot is 30 minutes, in the three inks), the time left or "Nothing planned", and a small curve in its own ink (graphite past, solid today, dashed for coming days). Past days are graphite and today has a faint ground and the now line.
- **iPhone.** The Today tab's header gains a glass button that switches between the list and the timeline, remembered across launches (`apps/mobile/src/lib/timeline.ts`, `components/timeline-face.tsx`). The face reads `planner/timeline:days` for the week: the day's name and date, a Week and Day switch, the Capacity ring, the week strip with each day's load dots, the summary row (predicted and Keep all, or done and not done on past days, or what did not fit), and the timeline with the rail, the Energy Curve, the now bead and pill, the three inks, outlined External Commitments, Trips and named gaps. A tap keeps a prediction and the box completes the Task, each optimistic and undoable. The week is seven columns of shapes with each day's planned time; a tap opens that day. The + button is the app's capture button. Shots: `timeline-app-iphone-*.png`.
- **Motion.** On web the hatch thickens into the fill on keep and a block drains to graphite as now passes it (360 ms through the registered properties; a 160 ms cross-fade under reduced motion), and now steps once a minute with a 360 ms ease. On iPhone the same moments are 360 ms Reanimated cross-fades that follow the system's Reduce Motion, and the bead eases to the new minute.
- **Not yet.** Dragging a prediction on iPhone, the sideways week, the energy reading card on tap, the Low energy day line, the swatch on each Task card in the day columns, Backspace or swipe to move a prediction's Task to another day, and Smart Block fills as predictions.
