# Canvas design

Mock screens for Canvas and Workflows in Notes. It is a design only: sample data, no backend, nothing runs a command. The live specimen is the Waku route `/design/canvas` in `apps/web` (run `pnpm dev:web`, open `/design/canvas`). Everything on it can be clicked. Whether it can be built, where it runs and the build order are in [docs/research/canvas-workflows.md](../research/canvas-workflows.md). The shared look is in [system.md](system.md).

## Direction

1. **A desk, not a diagram.** Notes, Tasks and loose lines sit on dot paper. You move them by hand and draw a line between any two.
2. **A Step is one command.** It takes values in and gives values out. Wired Steps run in order on the Mac and keep what has not changed.
3. **Pencil until you say run.** The AI lays out Steps in pencil while you watch. No command runs before you have read it, and one undo clears the lot.

## Where it sits

Inside Notes mode, from the Modes proposal in [notes.md](notes.md). A canvas is a kind of note: one row in the Area and Project tree with its own glyph, found by the same search and Cmd+K, opened in the same pane. There is no third mode and no new sidebar row.

The five crossings the Modes proposal lists still hold:

- A Task chip on a canvas is the real Task. It ticks and undoes in place.
- A note card opens its note beside the canvas.
- Cmd+J works on the canvas in front, and that is where "set up a workflow" is asked.
- The run strip sits at the foot of the window in both modes, so a render started in Notes mode can be watched and stopped from the Planner.
- On iPhone a canvas opens from the Notes tab like any note.

## Screens

Shots are in this folder as `canvas-<name>.png` and `-dark`. The four sections also have `-phone` and `-phone-dark`. Desktop is 1440 px wide, phone is 390 px.

| Section on the page | Shots | What it shows |
| --- | --- | --- |
| A canvas of notes | `canvas-notes` | Note cards, a text card, Task chips, a group and labelled links on dot paper. Drag a card and its links follow. A selected card shows the four dots a link starts from |
| AI builds it | `canvas-build`, `canvas-build-live`, `canvas-build-ask`, `canvas-build-run` | The ask at the foot, the seven Steps of the launch film arriving one by one in pencil, the asking-first card with every command, then the run starting |
| A run | `canvas-run` | A kept Step, a finished one, one running with its ruler filling, one waiting, the Frames card showing the last frame, the log tail and the strip with Stop |
| Custom blocks | `canvas-blocks` | A real sealed frame running its own page. Picking a still sends its time out by the socket into the next command. Beside it, where the line sits between LifeOS parts and a custom block |

### How the parts behave

- **Paper.** The stage is `background` with the dot grid from the notebook capture. Cards are `popover` with `shadow-lift`. Nothing has a border except pencil.
- **Links.** A graphite curve with an arrow and an optional label on a halo of the paper colour. A link starts from one of four dots on the side of a selected card.
- **Sockets.** A value's kind is a shape, never a colour, because colour belongs to Areas: a dot is text, a ring is a number, a filled square is a file, a hollow square is a folder. Inputs sit on the left edge, outputs on the right.
- **A Step.** A state mark and a title, the sockets, the command in a mono well with its inputs shown as small chips, and one line of state. A terminal glyph means a shell command. The AI mark means it starts Claude Code.
- **States.** Not run is a hollow ring. Waiting is a dashed ring. Running is a pulsing dot. Done is a tick. Kept (nothing changed, so it did not run again) is a faint tick. Stopped or failed is a red dot.
- **Progress.** A ruler of 36 ticks that fills as frames land, with the figure under it. A wire that is carrying work shows dots moving along it.
- **Pencil.** What the AI added and Avi has not yet kept is dashed, with no shadow. It turns to ink over `dur-slow` when he runs or keeps it.
- **Asking first.** The same dashed card as the AI design's, on glass at the foot of the canvas. It says nothing has run, names the one folder the Steps may write in, and lists each Step with its command, what it reaches and what it may cost. A row can be unticked. Run, keep without running, or undo all.
- **The strip.** The run strip from the AI design. While a run is live it always has Stop.
- **A custom block.** A card with the AI mark, a "Made for this canvas" tag and a line that says it is sealed.

## Motion

| Moment | Motion |
| --- | --- |
| Drag a card | It follows the pointer 1:1 from where it was grabbed and lifts to `scale(1.015)` over `dur-fast` |
| Pan and zoom | Direct. Zoom holds the point under the pointer still |
| A Step arrives | `fade-in`, 200 ms. Its wire fades in with it |
| Pencil to ink | Border, fill and shadow over `dur-slow` |
| A live wire | Dots travel the wire, 0.9 s a cycle |
| The ruler | Each tick changes colour over `dur-fast` |
| Strip words | `MorphText` |

Reduced motion: the wire's dots stand still and the running dot stops pulsing. The figures still change, because they are the information.

## Where the code lives

All of it is under `apps/web/src/components/design-board/canvas/`. It takes plain props and sample data.

| File | What is in it |
| --- | --- |
| `model.ts` | The shapes: a card (note, text, Task, group, Step, View, Block), a socket, a link, a Step's state, and the geometry of a link between two cards |
| `sample.ts` | The thesis map, the seven Steps of the film pipeline, the run and the poster block |
| `stage.tsx` | `Stage`: dot paper, pan, zoom, dragging cards, and the links drawn as SVG |
| `cards.tsx` | `StepView`, `WiredCard`, `SocketMark`, `Ticks`, `Tick`, and the plain cards |
| `notes-canvas.tsx`, `build.tsx`, `run.tsx`, `block.tsx` | The four specimens. `build.tsx` holds the build as a reducer: idle, building, asking, running, kept, stopped |
| `board.tsx` | The page |

### Checking it

```sh
BASE=http://localhost:3990 uv run --with playwright python apps/web/scripts/check-canvas-design.py docs/design
```

It shoots every section in light and dark at both widths, then drives the page: drag a card and see its link follow, tick a Task, zoom and fit, build the workflow, leave a Step out, run, stop, undo all, stop and carry on a render, and pick a still inside the sealed frame.

## Notes for the build

- The stage here is hand-made and small. The real canvas uses React Flow with these cards as its node components (the research page says why).
- The mock's stage lets the page scroll under a vertical swipe on a phone. The real canvas takes every touch.
- Cards cannot be moved from the keyboard here. The real one needs arrow keys to move a selected card and a way to start a link without a pointer.
- The custom block uses the system font, because a sealed frame cannot load Inter. The real host should hand it the font as data with the tokens.
