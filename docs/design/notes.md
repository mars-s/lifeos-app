# Notes design

The design for the Notes module, for whoever builds it. It is a design only: sample data, no backend. The live specimen is the Waku route `/design/notes` in `apps/web` (run `pnpm dev:web`, open `/design/notes`). Everything on it can be clicked. The shared look is in [system.md](system.md).

## Direction

1. **Paper first.** The page is the brightest thing on screen. The chrome steps back until you reach for it.
2. **Everything links.** Notes, Tasks, Projects and Areas point at each other, and every link is something you can press.
3. **Always yours.** It works offline, saves as you type, and merges edits from other devices without asking.

It is Obsidian's model (Markdown, `[[wiki links]]`, backlinks, a daily note) drawn in the LifeOS look, with a few things taken from the [Cupertino theme](https://github.com/svnaxis/obsidian-cupertino) for Obsidian (MIT). Nothing was copied from the theme's CSS and none of its branding is used.

## What came from where

| From LifeOS | From Cupertino |
| --- | --- |
| Warm paper and graphite, layers of tone, no borders | The reading column: 700 px wide at most, a 1.625 line height |
| Inter for words, Geist Mono for figures | Restrained headings: small steps in size, weight does the work |
| Depth buttons, press feedback on pointer down, undo on every change | Round to-do boxes |
| Dots for anything you can count. Area colours as dots only | Links in the accent colour with no underline until hover |
| The Task checkbox, chips and the Estimate chip, reused as they are | A see-through sidebar on the Mac, and glass menus that blur what is under them |
| The motion tokens. Cupertino's main curve is the same as our `ease-drawer` | A bar in the margin on the line you are on |
| Amber is kept for the Deadline, so no callout is amber | Callouts as a soft tint of their colour with the text set in under the title |
| | Tables with no grid lines, on a rounded step of tone |
| | On iPhone: floating glass bars, a tool bar that floats above the keyboard, grouped lists |

Left out on purpose: Cupertino's solid accent fill on the selected menu row (we keep the neutral tint), its squircle corners (`corner-shape` is not in every engine yet), its coloured icon tiles, and its 30 extra checkbox marks.

## Screens

Each screen has four shots in this folder: `notes-<name>.png`, `-dark`, `-phone` and `-phone-dark`. Desktop is 1440 px wide, phone is 390 px.

| Section on the page | Shots | What it shows |
| --- | --- | --- |
| Home and editor | `notes-home`, `notes-editor-phone` | The whole window. LifeOS sidebar with the Notes row, the notes column (search, New note, Today, Recent, the Area tree, Unfiled), the page, and the links panel. Below 672 px it is one pane at a time: the list, then the page with a Notes back button |
| Writing | `notes-writing` | Live preview, linking as you type, a line becoming a Task, chips for Tasks, Projects and Areas, callouts, table, code, image, quote, and the type scale |
| Links | `notes-links` | The links panel (small graph, Tasks, Linked from, Links out, not created yet) and the whole graph |
| Daily note | `notes-daily` | The day tied to the Planner, and the capture for typing in a notebook page |
| In the app | `notes-shell` | The sidebar row, the command bar with notes in it, and a note open beside the Planner |
| Modes (built 28 Nov 2026) | `modes`, `modes-notes` | Planner and Notes as two modes of one window: the switch, what the sidebar shows in each, what crosses over, and the iPhone |
| States | `notes-states` | Three empty states, the sync indicator, and the merge moment |
| iPhone | `notes-iphone` | Notes home, writing with the keyboard up, the links sheet, and the notebook capture |

### How the parts behave

- **Notes column.** Search filters as you type and marks the match. No result offers a new note with that title. Today is always the first row. The tree is Areas, then their Projects, then notes. There are no other folders.
- **Live preview.** Markdown renders as you type. Only the line with the caret shows its syntax. Block marks (`##`, `>`) hang in the left margin, so the words never move sideways. Inline marks (`**`, `[[ ]]`) show in faint mono around the words they wrap.
- **Linking.** `[[` opens one list of notes, Tasks and Projects. A match at the start of a title or a word comes first. Arrow keys and Enter. The last row always makes a new note. A link to a note that does not exist yet has a dashed underline, and the links panel offers to create it.
- **Chips.** A link to a Task, Project or Area is a chip with the depth-button face. The Task chip holds the real checkbox: ticking it completes the Task everywhere and raises the usual undo toast.
- **To-do against Task.** A round box is a to-do that lives only in the note. A square box is a Task. Make Task (or Cmd+Enter on the line) turns the first into the second. The Task takes the note's Area and Project. One undo turns it back.
- **Links panel.** Tasks that mention the note come first, then notes that link here with the sentence around the link, then what this note links to. The small graph shows the neighbours only.
- **Graph.** A dot is a note. It is larger when more links touch it and takes its Area colour. Journal and unfiled notes are neutral ink. Hover traces a dot's links and fades the rest. It is laid out by hand in the specimen; the real one needs a layout that keeps still between visits.
- **Daily note.** One note a day. Today shows the Planner's day meter and Tasks, live, above the journal. A dot under a date means something was written. The month is a row of dots: filled is a written day.
- **From the notebook.** Made for typing with the Moleskine open. Each line is one field. Enter starts the next line, Backspace on an empty line goes back, a leading `t ` or `[]` turns the line into a Task and leaves the title clean, Backspace at the start of a Task line turns it back. The page number is in view and counts up after each page. Cmd+Enter or Add page saves the page into that day with one undo. The day can be stepped back for pages written earlier.
- **Beside the Planner.** A Task that links to a note shows the note as a small chip. Pressing it slides the note in over the calendar. Cmd+Enter in the command bar does the same from anywhere.
- **Sync.** One dot and a few words, in the sidebar foot and as a dot in the note's top bar (words on hover). Synced is a green dot. Offline is a hollow dot and says how many edits are kept on this device. It is never red, because offline is the normal case. Merging is three small dots that pulse while edits arrive.
- **Merge.** Edits from another device fold in where they belong. Each arrives with a faint brand tint that fades in 1.8 s. No toast, no dialog, nothing to resolve.

## Type and spacing

Note text is one step larger than the app's body text, because a note is read for longer than a Task title.

| Style | Size / line | Tracking | Weight |
| --- | --- | --- | --- |
| Note title | 28 / 34 | -2.2% | 600 |
| Heading 1 | 22 / 28 | -1.8% | 600 |
| Heading 2 | 18 / 26 | -1.2% | 600 |
| Heading 3 | 16 / 26 | 0 | 600 |
| Body | 16 / 26 | 0 | 400 |
| Aside (meta, captions, table text) | 13 / 20 | 0 | 400 |
| Code | 13 / 22 | 0 | Geist Mono 400 |

A compact scale (title 24 / 28, body 15 / 24) is used where the note sits in a narrow pane: beside the Planner and in the daily note.

- The reading column is 700 px at most, with 48 px of margin each side on a wide pane and 24 px on a narrow one.
- Space above a heading is 32 px, and 8 px below it. Paragraphs sit 16 px apart, lists 12 px, and quotes, code, callouts and tables 20 px.
- List rows are 4 px apart. The box or bullet sits in an 18 px slot, 10 px from the text.
- Notes column rows: 28 px in the tree, two-line rows for Recent, 8 px radius, 8 px side padding. Search is a 32 px pill.
- Figures in tables, counts, page numbers and code are Geist Mono. Dates stay in Inter.
- Radius follows the system: 12 px on images, code, callouts and table bodies, 16 px on panels and popovers, full on chips and pills.

## Colour

No new colours. Links are `brand`. Callouts mix their colour at 11% in oklab: `brand` for a note, `positive` for an idea, `area-plum` for a question, `negative` for a warning. Dot paper is `foreground` at 11% on a 16 px grid, and only appears where text came from the notebook.

## Motion

| Moment | Motion |
| --- | --- |
| Open a note with the pointer | The page fades in over 200 ms. From the keyboard it is instant |
| Fold an Area in the tree | Grid rows over `dur-base`, chevron turns over `dur-fast` |
| Move the caret to another line | The margin bar fades over `dur-fast`. Marks appear at once |
| `[[` list | No animation. It is opened from the keyboard |
| Tick a to-do or a Task | The existing checkbox fill, tick and strike |
| Make Task | The box corner goes from round to 6 px over `dur-base`, the Area label fades in, and an undo toast is raised |
| Press a chip or a row | `scale(0.97)` or `0.985` on pointer down, `dur-press` |
| Note beside the Planner | Slides 24 px and fades, 320 ms on `ease-drawer` in, 160 ms out |
| Sync words | `MorphText`. Merging dots use the `pending` keyframes, 160 ms apart |
| Merge | New lines fold in over `dur-base`. The tint fades over 1.8 s |
| Graph hover | Opacity over `dur-fast` |
| Notebook line becomes a Task | Bullet and box cross-fade and scale over `dur-base` |
| iPhone | Glass buttons press to 0.94. Depth buttons move down 1 px and press to 0.97, like the app's `Pressed`. Sheets use the app's settle spring |

Reduced motion: folds and slides become instant or a fade, pulses stop, and the merge tint still fades, because it carries meaning. Reduced transparency: glass and the see-through sidebar become solid. Haptics use the five names that exist: `toggle` for a to-do, `complete` for a Task. No new names.

## Where the code lives

All of it is under `apps/web/src/components/design-board/notes/`. It takes plain props and sample data.

| File | What is in it |
| --- | --- |
| `model.ts` | The shape of a note: blocks, inline parts, links to Tasks, Projects and Areas, the sync state. Backlinks and outgoing links are worked out from the blocks, never stored twice |
| `sample.ts` | Thirteen sample notes, the Tasks and Projects they link to, the tree |
| `prose.tsx` | The note renderer (`NoteProse`), `EntityChip`, `WikiLink`, `LabelPill`, `Callout`, `NoteTable`, `CodeBlock`, `TodoLine`, and the type scale in `NOTE_TYPE` |
| `parts.tsx` | `SyncIndicator`, `NoteRow`, `SearchPill`, `LinkDots`, `Fold`, and the glass recipe |
| `window.tsx` | The whole window: sidebar, notes column, editor, links panel |
| `links.tsx` | `Backlinks`, `OutgoingLinks`, `LocalGraph`, `VaultGraph` |
| `daily.tsx` | `DailyNote`, `NotebookCapture`, `NotebookPages`, `WeekStrip`, `MonthDots` |
| `writing.tsx`, `shell.tsx`, `states.tsx`, `iphone.tsx` | The specimens for each section |
| `state.tsx` | The small in-memory state the specimen runs on |

It reuses `TaskCheckbox`, `StrikeTitle`, `EstimateChip`, `DayMeter`, `SidebarItem`, `ProgressPie`, `AreaDot`, `Segmented`, `Button`, `Kbd`, `Tag`, `MorphText`, the toast stack and `showUndo`.

Two existing files changed: `convex-client-provider.tsx` lists `/design/notes` as a public path, like `/design`, and `pages.gen.ts` was regenerated by Waku.

### Tokens to add when Notes is built

No token was added to `styles.css`, to stay out of the way of other work on that file. These live as constants for now and should become tokens then:

| Proposed token | Value | Why it is missing |
| --- | --- | --- |
| `text-note` | 16 / 26 | Body text is 15 / 24, tuned for one-line Task titles, not paragraphs |
| `text-note-title` | 28 / 34, -2.2% | Sits between `text-title` (24) and `text-display` (44) |
| Note headings | 22 / 28, 18 / 26, 16 / 26 | The app has one heading size |
| A glass surface | `popover` at 75%, 24 px blur, 1.5 saturation | Menus are solid today |

### Checking it

`apps/web/scripts/check-notes-design.py` opens the page in light and dark at both widths, fails if the page scrolls sideways or logs an error, takes every shot in this folder, and clicks through the window, the link list, the notebook capture, the merge moment and the note beside the Planner.

```
BASE=http://localhost:3990 uv run --with playwright python scripts/check-notes-design.py ../../docs/design
```

## Modes

Avi asked on 28 Nov 2026 whether Notes should be a toggle (Note mode, Planner mode) and not a sidebar row. Avi approved it on 28 Nov 2026 and it is built on web and Mac: `modes.tsx` holds the switch and the remembered places, `check-modes.py` drives the switch, the keys and the five crossings, and `modes-app*.png` are shots of the real app. A Task chip in a note opens the real Task card over the note (`task-beside.tsx`), Cmd+J on a note asks LifeOS AI about that note, and each Planner day header has a button for that day's note. Shots: `modes.png` (Planner mode) and `modes-notes.png` (Notes mode), each with `-dark`, `-phone` and `-phone-dark`.

The view: yes on web and Mac, as long as the switch changes the sidebar and never what you can reach.

- **Why a switch.** The Notes row is the only sidebar row that is not a list of Tasks, and pressing it already replaces the lists with a second column. Notes is the other half of the app, so it should not look like one more list. A switch also gives the notes column the whole sidebar and removes a column from the window.
- **The switch.** Two glyphs, Planner and Notes. In the Mac title bar beside the traffic lights, and at the top of the sidebar on the web. Cmd+1 and Cmd+2 from anywhere. The keys do not animate. A click slides the thumb in 160 ms.
- **The sidebar.** Planner mode: Inbox, Today, Planner, Anytime, Someday, the Areas, Logbook. Notes mode: search, Today's note, Recent, the Area and Project tree, Unfiled. The sync line stays at the foot in both. Each mode remembers its place, so Cmd+1 then Cmd+2 returns to the same note.
- **What crosses over.** A note still opens beside the Planner from a Task's chip or Cmd+Enter in the command bar, without a mode change. Task chips in a note tick, open the card and undo in place. Cmd+K searches both and switches mode only when Enter takes you to the other half. Cmd+J works on the Task or note in front and reads both. The Planner's day header links to that day's note, and the daily note keeps showing the Planner's day.
- **iPhone.** No switch. The tab bar is already one, and Notes keeps its tab.
- **The risk.** A mode can turn into a wall. If any of the five crossings above is cut, go back to the sidebar row.

## Notes for the build

Sync and storage are decided in issue #82 (Yjs, a relay on Cloudflare Durable Objects, CodeMirror 6). The design assumes that shape:

- **Editor.** Live preview maps onto CodeMirror decorations. Rendered blocks and chips are widget decorations, and a chip is atomic, so the caret steps over it. The margin marks and the bar are line decorations on the active line. The reading column, the type scale and the spacing above are the editor theme.
- **iPhone.** The page is the same editor in an Expo DOM component. Everything that floats over it (the back button, the links pill, the tool bar above the keyboard, the sheet, the depth buttons) is native Liquid Glass, not web.
- **Sync indicator.** Synced means the socket is open and caught up. Offline means the socket is closed, with the count of local updates not yet sent. Merging shows while remote updates are being applied.
- **Merge tint.** A remote transaction marks the ranges it changed, and the mark fades. Local edits never tint.
- **Search and the command bar.** They read the projection in Core (title, Area, excerpt), so results show without opening a note.
- **Tasks.** A chip stores an entity reference, not a title. Make Task goes through the same `changeMutation` as any new Task, so Activity and undo work as they do everywhere else.

## Open questions for Avi

1. **Typeface.** Notes are in Inter, like the rest of the app. The page has an Inter and System switch under the window. Do you want San Francisco for note text on Apple devices?
2. **Where Notes sits.** Settled: the Planner and Notes switch in Modes above, built 28 Nov 2026.
3. **iPhone tab.** Notes is drawn as a fifth tab. The other choice is a row inside Lists.
4. **Folders.** Areas and Projects are the only folders. Do you want free folders as well?
5. **To-dos.** A round to-do stays in its note. Should open to-dos show anywhere in the Planner, or only once you make them a Task?
6. **The notebook.** A leading `t` makes a Task. Do you use other marks in the Moleskine that should mean something? Is there more than one notebook, so that a page number needs a notebook name?
7. **Daily note and rituals.** Should Shutdown write its summary into the day's note, and should the Planner's day header link to it?
8. **Graph.** The small graph in the links panel and the whole graph are both drawn. Keep both, or only the small one?
9. **See-through sidebar.** It needs window vibrancy in the Mac app. Wanted, or keep the solid surface everywhere?
10. **Labels.** `#tags` in a note are the same Labels as on Tasks. Is that right, or should notes have their own?
