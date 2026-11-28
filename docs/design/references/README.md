# Design references

Screenshots Avi picked on 18 November 2026 as the quality bar and the source of the product shape. Each entry says what to take from it. The spec that uses them is GitHub issue "Spec: LifeOS planner, data model and tactile UI".

## Planning flow (Sunsama and Ellie)

| File | Take from it |
| --- | --- |
| `01-sunsama-day-columns-and-calendar.png` | One column per day, each with "Add task" and the day's planned total (8:00). Task cards show an estimate (4:00), subtasks and a channel tag. The calendar sits beside the columns. Rituals in the sidebar: daily planning, daily shutdown, weekly planning and review. |
| `02-ellie-brain-dump-days-timebox.png` | Brain Dump list on the left, day columns in the middle, a Timebox calendar on the right. Cards show estimate, label dot and the planned start time. Dragging a card lifts it with a ghost. Footer shows "Last synced a few seconds ago" and a floating focus timer button. |
| `03-ellie-week-calendar.png` | Week calendar where tasks become checkable blocks. Done blocks fade and strike through. External events keep their source icon. |
| `04-ellie-feature-grid.png` | Feature list: analytics (time per day by label, estimated against actual), recurring rules, labels and filters, keyboard shortcuts, Pomodoro, daily planning and shutdown summary, subtasks, task templates, lists with counts. |

## Task model and calm craft (Things 3)

| File | Take from it |
| --- | --- |
| `05-things-today.png` | The Today list at its simplest. Sidebar order: Inbox, Today (with count), Upcoming, Anytime, Someday, Logbook, Trash, then areas. |
| `06-things-upcoming.png` | Upcoming as days with a large date number. Calendar events appear inline with coloured times. A small yellow bar marks a deadline. |
| `07-things-anytime.png` | Anytime grouped by area, Today items starred, "Show 2 more" to keep groups short. |
| `08-things-someday.png` | Someday tasks use a dashed checkbox. |
| `09-things-area-page.png` | An area page: icon, title, a "more" menu, then its tasks and projects. |
| `10-things-task-expanded.png` | A task opens in place into a card: title, notes, When, then tag, checklist and deadline buttons. No modal. |
| `11-things-checklist-button.png` | The checklist button grows into a labelled control on hover. |
| `12-things-checklist-item.png` | Checklist items live inside the expanded card with a drag handle. |
| `13-things-new-project-or-area.png` | "New List" offers New Project ("define a goal, then work towards it one to-do at a time") or New Area ("group projects and to-dos by responsibility"). |

## Visual personality (TuffUI)

| File | Take from it |
| --- | --- |
| `14-tuffui-message-log.png` | Dot-matrix timeline you can brush to filter, monospace numbers, tiny inline bars, attempt dots. The model for our activity and focus visualisations. |
| `15-tuffui-component-grid.png` | The wider family: rings, gauges, heatmaps, step charts, lap timers. Tactile, analog and precise. TuffUI is MIT and installs as a shadcn registry (https://tuffui.com/llms.txt). |

## AI on the line (Notion AI, 2023)

Stills from Notion's own launch videos, picked by Avi on 26 November 2026 as the best way he has seen to put AI in an app without a chatbot. The design that uses them is [ai.md](../ai.md).

| File | Take from it |
| --- | --- |
| `notion-ai/notion-ai-1.png` | It starts from your own text: a selection, or the line the caret is on. Nothing else on the page changes. |
| `notion-ai/notion-ai-2.png` | Cmd+J raises one field right under the text, with a short list of actions below it. Quick actions first, typing second. |
| `notion-ai/notion-ai-3.png` | The actions are plain verbs in groups, with the first one already selected so Enter works at once. |
| `notion-ai/notion-ai-4.png` | The answer sits under your text, never over it. Then: Replace, Insert below, Continue, and a field to say what to do next. |
| `notion-ai/notion-ai-5.png` | Free text works in the same field ("Create a table"). There is no second place to type. |

Leave behind: the purple sparkle, the answer living inside the floating box (ours is written onto the page in pencil), and the long menu.

## Widgets (health stat tiles)

Picked by Avi on 28 November 2026 as the style for the iPhone and Mac widgets. The design that uses it is [widgets.md](../widgets.md).

| File | Take from it |
| --- | --- |
| `widgets/01-health-stat-tiles.png` | Dark glass tiles, one stat each. A big dot-matrix number, a small title over a one-word state (balanced, recovered, low), a tiny unit badge on the right, and a thin analog strip at the foot: tick scales, bars, dots, a time axis with a label at each end. Calm, one ink, tactile. |

Leave behind: the hover tooltip and the wide chart (a widget is a still snapshot), and the health subject itself.

Avi's notes alongside these:

- Keep the deadline and the allocated time separate.
- Areas work like Things areas. Projects live under an area, or stand alone.
- Feedback first: every action answers back. Use visualisations to give the app personality.
- The bar is Things 3, Claude and Grok apps. If the UX is not that good, Avi will not use it.
- [AffectUI reference library](affectui/README.md) for generative UI and in-app agents.
