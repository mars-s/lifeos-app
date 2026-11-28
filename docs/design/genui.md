# GenUI: a grammar and a sealed frame

How the AI draws any kind of data in LifeOS without a hand-made component for each. A working prototype is the Waku route `/design/genui` in `apps/web` (run `pnpm dev:web`, open `/design/genui`). Nothing here is wired into the app yet. Tracked in #87, for Canvas (#86) and LifeOS AI (#83).

## Verdict

1. **It works, and a small model can write it.** Haiku 5.5, given only the prompt and one request, wrote a valid spec on the right layer 18 times out of 18, twice in a row.
2. **One language covers layers 2 and 3.** The AI writes short tags. If every tag is ours the block draws in the app. If it also wrote HTML of its own, the same tags draw inside a sealed frame.
3. **The two layers are the same pixels because they are the same code.** One small renderer and one stylesheet run in the app and inside the frame. The check script measures a figure, a button and a table cell in both and they match.
4. **It is cheap.** The prompt is 1,404 tokens. A grammar block is about 77 tokens to write, a frame about 290. Tags cost 36% of the same block in plain JSON.
5. **Three things are not proven:** haptics from inside a frame on a real iPhone, the frame under Tauri (the IPC test from the Canvas research), and any model other than Haiku.

## The three layers

| Layer | When | What the AI sends |
| --- | --- | --- |
| 1. LifeOS parts | Data we know: a Task, a note, capacity, a day | `<Part is=task id=…/>`, drawn by the app's own component |
| 2. The grammar | Everything else | Tags from the list below |
| 3. A sealed frame | Only what tags cannot draw: 3D, a game, free drawing, custom motion, logic of its own (random numbers, timers) | `<Frame>` with HTML, `<style>` and `<script>`, and any tags it likes |

The rule the model gets: use the tags, and only when they cannot draw it wrap that part in `<Frame>`. The host does not trust the choice. A spec with plain HTML outside a `<Frame>` fails the schema.

## The grammar

A spec is a list of tags. A value is bare (`cols=3`), quoted (`"two words"`) or bound (`{name}`). The top level is a column. Twenty-two tags:

| Kind | Tags |
| --- | --- |
| Layout | `Col`, `Row` (`gap`, `align`), `Grid cols`, `Card title` |
| Show | `Text` (markdown, `size`, `tone`), `Tag`, `Num` (a dot-matrix figure with label, unit and state), `Meter` (`ring`, `bar`, `ticks`, `dots`), `Chart`, `Table` (`cols`, `group`), `List` (repeats its children per row), `Item`, `Image`, `Media`, `Part` |
| Controls | `Button`, `Slider`, `Pick` (`segment`, `swatch`, `menu`), `Toggle`, `Input` |
| Data | `Data` |
| Escape | `Frame` |

The full list with every attribute is `CATALOGUE` in `packages/backend/shared/client/genui.ts`. There is no icon tag and no colour attribute: tone is one of five words, and series colours come from the Area palette.

**Charts** are a grammar of graphics, the Vega-Lite idea cut to one line: `<Chart mark=bar|line|area|point|spark data=name x=col y=col series=col/>`. Rows that share an `x` are summed, `y=count` counts them, and `series` stacks bars or draws one line each. The axis follows the widgets rule: one figure at the top, labels along the bottom, nothing else. Arrow keys and a finger move a readout along the marks.

**Data binding.** A block never holds LifeOS data. It names it:

- Inline: `<Data name=sleep>` with CSV inside. CSV is the cheapest way to carry rows, and the model copies the user's numbers instead of retyping them into attributes.
- Live: `<Data name=tasks from=list_tasks view=today/>`. `from` is a read tool from the one tool registry (`convex/tools.ts`), run as a reactive Convex query, so the block updates when the data does.
- Sockets: a Canvas block's inputs exist by name and are not declared.
- Reading: `{tasks.count}`, `{sleep.hours.avg}` (also `sum`, `min`, `max`, `first`, `last`), `{focus.elapsed}` for a one-row read, and `{col}` inside a `List`. The renderer does the sum, so the model never does arithmetic.

**State and outputs.** A control has `bind=name`. Anything can read `{name}`, and the value leaves a Canvas block by the output socket of that name. There is no expression language. Logic belongs in a Frame.

**Actions.** `<Button label=… tool=start_focus minutes=25/>` calls a tool from the registry with the other attributes as its arguments. The call goes through the same approval policy as any agent call (`ai/policy.ts`): the button shows busy until the policy answers. A block cannot call a tool the context did not list, and the schema rejects one that tries.

**States.**

| State | What you see |
| --- | --- |
| Arriving | The spec is parsed as it streams. Each tag appears when its `>` lands and fades in over 220 ms. A Frame waits for its closing tag |
| Loading | Each part draws its own ghost in its own shape (a figure, bars, three rows) until its data arrives |
| Empty | "Nothing here" or "No data yet" in the part's place. Never a blank card |
| Stale | The last answer stays, dimmed, with "As of 9:41 am" in the card's header |
| Not valid | Nothing is drawn. The card says so, and the issues go back to the model for one retry. They are written as sentences for that reason: "`<Chart y=minutes>` is not a column of s." |
| A script stopped | The frame reports the error and the card shows one quiet line |

**Motion.** A dot figure flips its own dots (opacity, 260 ms, a 6 ms stagger per column). Words and inline numbers morph with torph. Bars, ticks and rings change colour or scale over 160 to 320 ms. Nothing loops except the ghost. Under reduced motion everything swaps in place.

## The format, with token numbers

Five blocks (a sleep chart, Tasks by Area, a trip summary, a pomodoro control, render progress) were written as the same tree in seven formats and counted with `o200k_base`, the tokenizer of the OpenAI models LifeOS uses.

| Format | Tokens | Against plain JSON |
| --- | --- | --- |
| json-render patch lines (flat map, one JSON Patch a line) | 1,541 | 118% |
| Plain nested JSON | 1,304 | 100% |
| A2UI-style flat list with ids | 1,165 | 89% |
| Compact JSON arrays `["Num",{…}]` | 619 | 47% |
| Tags, quoted values | 503 | 39% |
| **Tags, bare values (chosen)** | **466** | **36%** |
| A line DSL with indentation | 426 | 33% |

**Picked: tags with bare values.** The line DSL is 9% smaller, but it is a language no model has seen, it breaks on one wrong indent, and it would need a second language for layer 3. Tags are the JSX every model already writes, a half-arrived tag is easy to drop while streaming, and a Frame is the same language with lowercase HTML allowed. Capitalised is ours, lowercase is HTML: the JSX rule.

What was taken from the two references, and what was left:

- **A2UI** (v1.0, Apache-2.0): a fixed catalogue the host owns, data kept apart from layout and bound by path, actions sent to the host by name. Left: the flat list of components wired by id. It costs more tokens and a missed id orphans a subtree.
- **json-render** (v0.23, Apache-2.0): the catalogue is the schema and the prompt is checked against it, and the UI renders while it streams. Left: JSON Patch lines, the dearest format measured.

Only tags were tried with Haiku. The other formats were measured for size, not for how well a small model writes them.

## The seam

How layers 2 and 3 are made one thing.

| Thing | How both get it |
| --- | --- |
| The renderer | `runtime.js` is imported by the app and also handed to the frame as text. A `Num` in a frame is drawn by the same function |
| The stylesheet | One string, `GU_CSS`. It also styles a bare `button`, `input`, `select`, `table`, `h1` to `h3` and `canvas`, so plain HTML already looks right |
| Colour | The app reads its own tokens with `getComputedStyle` and writes them into the frame. They are `light-dark()` pairs, so nothing is copied by hand and nothing drifts |
| Names the AI uses | `--ink`, `--dim`, `--faint`, `--track`, `--well`, `--paper`, `--good`, `--warn`, `--bad`, `--font`, `--mono`. A canvas asks `ui.color("ink")` |
| Type | Inter and Geist Mono go in as `data:` fonts, so the frame is not on the system font |
| Card | The app draws the card, the title and the header for both. The frame is only the body |
| Size | The frame reports its height and the card follows. It never scrolls inside |
| Loading | The same ghosts, drawn by the same code. The frame stays hidden until ready, and a host ghost shows only if that takes more than 150 ms |
| Light and dark | The app tells the frame which is on. Nothing reloads, and `ui.on` fires so a canvas can redraw |
| Focus and keys | Tab walks through the frame in order with the same ring. Escape hands focus back |
| Values | `ui.set("n", 4)` and `<Slider bind=n/>` write the same named value. It crosses between a grammar part and a frame in one card |
| Tools and data | `ui.call(tool, args)` and `ui.rows(name)` go over `postMessage` to the same host functions the grammar uses, so the approval policy is the same |
| Haptics | Every control calls one `haptic(kind)`. In the frame it crosses the bridge to it |

**The seal.** `<iframe sandbox="allow-scripts" srcdoc>` with `default-src 'none'; script-src 'unsafe-inline' data:; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:`. The check script proves a frame cannot fetch, cannot use storage or cookies and cannot read the page, and that the page cannot read the frame. `data:` scripts are allowed only so the host can hand torph in as a module.

**How a frame is built.** The parser reads the whole spec, HTML included. Inside a `<Frame>`, layout tags become plain `div`s, each other grammar tag becomes a `<gu-slot>` that the runtime fills as the page parses, `<script>` and `<style>` pass through untouched, and the runtime with `ui` loads first. So `<Num value={roll}/>` beside a `<button onclick>` just works, and a dice roller is eight lines.

## The three libraries

| Library | Verdict | How |
| --- | --- | --- |
| **torph** 0.1.4 (already a dependency) | Used | Every bound word and inline number goes through one `say(element, text)`, which is torph's vanilla `TextMorph` (280 ms, the app's ease-out). In the frame the same package source is handed in as a `data:` module, so text morphs there too. Dot figures do not use it: they flip dots |
| **web-haptics** 0.0.6 (already a dependency) | Used | Through the existing `lib/haptics.ts`: web-haptics on a touch screen, the trackpad on the Mac. A step of a slider is `snap`, a pick or a switch is `toggle`, a tool button is `drop` then `complete`. A frame calls `ui.haptic` and the host fires it. On iPhone the same bridge message goes to expo-haptics |
| **skullet** 0.0.3 | Not used inside a block | It measures the real DOM and remembers shapes in `localStorage`. A sealed frame has no storage, the app cannot measure inside it, and it has no React Native build, so it would make the two layers load differently. Each part draws its own ghost instead, which is the same in both. It does fit the web shell around layer 1 parts and the ⌘J answer, where the shape comes from a React component. It is left for that slice and not installed here |

## What Haiku did

`packages/backend/convex/ai/genui/eval/` holds 18 requests, what was sent (`asks/`), and every reply (`round-1/`, `round-2/`). Each Haiku 5.5 subagent read the prompt and one request and nothing else.

| | Valid | Right layer | Looks right | Mean tokens out |
| --- | --- | --- | --- | --- |
| Round 1, first prompt (1,369 tokens) | 18 of 18 | 18 of 18 | 12 of 18 | 96 grammar, 293 frame |
| Round 2, final prompt (1,404 tokens) | 18 of 18 | 18 of 18 | 17 of 18 | 77 grammar, 291 frame |

"Looks right" is my read of the rendered card: nothing repeated, clipped or off-token. Round 1's six misses were one habit: repeating the card's title as a heading, wrapping everything in a `Card`, or saying a label twice. Two sentences in the prompt fixed it and made the specs shorter. The one miss left is the signature pad, whose canvas has no edge until you sign. No reply in either round wrote its own colour or font.

Thirteen requests should be grammar and five should be frames (a dice roller, a 3D logo, a breathing circle, noughts and crosses, a signature pad). Haiku chose all 18 correctly both times, including the colour picker, which it wrote as one `Pick kind=swatch`.

The prompt is 1,050 tokens of reference and four examples. It names no vendor and uses no tool calling or JSON mode, so it works through the AI router on OpenAI and OpenCode Go as plain text out.

## Where the code lives

| File | What is in it |
| --- | --- |
| `packages/backend/shared/client/genui.ts` | The schema: `CATALOGUE`, `parseSpec` (also for a stream), `checkSpec`, `readSpec`, `frameMarkup`. Plain TypeScript, imported as `@lifeos/backend/client/genui`. It is a data catalogue with a checker, not zod, because the backend has no zod of its own and the frame cannot carry it |
| `packages/backend/shared/client/genui.test.ts` | Examples valid, prompt names every tag, Haiku's replies valid and on the right layer |
| `packages/backend/convex/ai/genui/prompt.md`, `examples/` | The prompt and its four examples as files |
| `packages/backend/convex/ai/genui/eval/` | Requests, asks and both rounds of replies |
| `apps/web/scripts/genui-eval.mjs` | `asks`, `score <round>`, `board <round>` |
| `apps/web/src/components/design-board/genui/runtime.js` | The renderer and stylesheet both layers share. Plain JavaScript so the same text can go into a frame |
| `…/genui/block.tsx`, `world.ts` | The card, the frame host and its bridge, and sample data that ticks |
| `…/genui/board.tsx`, `specs.ts`, `outputs.gen.ts` | The page. `outputs.gen.ts` is round 2, written by the eval script |

```sh
BASE=http://localhost:3990 uv run --with playwright python apps/web/scripts/check-genui-design.py docs/design
```

It shoots every section in light and dark at 1440 and 390 px (`genui-<section>.png`, `-dark`, `-phone`, `-phone-dark`), then checks: 18 blocks of which five are frames, the same computed type, colour and radius on a figure, a button and a table cell in both layers, the seal, a roll of the dice, a game won, a slider value crossing into a frame, a tool call changing live data, arrow keys on a chart, a block streaming in, and a theme change reaching the frame.

## Slices

1. **The package.** Move `runtime.js` to `packages/genui` in TypeScript with a build step that emits the frame's copy as one string. Turn `prompt.md` into a module Convex can import. Add skullet for the web shell if it earns it.
2. **⌘J answers.** A `data-genui` message part carrying a spec. The reads come from the tool registry, the retry on a failed check is one extra step, and the prompt joins the agent's system prompt through the AI router.
3. **Canvas View cards.** A View holds a spec. Its sockets are the data, `bind` names are its outputs. An `add_view(title, spec)` tool for the agent.
4. **Tools from a block.** `Button tool=` and `ui.call` through `ai/policy.ts`, with the Approval Card when the policy asks.
5. **The frame for real.** Files from sockets handed in as bytes, the Tauri IPC test from the Canvas research first, a time and memory limit, and Stop.
6. **iPhone.** The renderer in an Expo DOM component (the same web view as the notes editor), haptics bridged to expo-haptics, and a test on a device.
7. **Parts.** `Part` mounting the real Task row, note, capacity dots and day strip in a slot.

## Choices made without asking

- Tags over the slightly smaller line DSL, for one language across both layers.
- No expression language, no icons and no colour attribute in the grammar. A Frame covers the rest.
- The app, not the spec, owns the card and its title.
- A read for the running Focus Session (`get_focus`) is assumed. The tool registry does not have one yet.
- skullet was judged and left out, so no dependency was added.
- The `Part` tag is in the schema and the prompt but draws a placeholder here.

## Not proven

- Whether the iOS haptic fires when the tap happened inside a frame and reaches the page as a message. web-haptics relies on an undocumented Safari behaviour either way.
- A sealed frame under Tauri on macOS (carried over from the Canvas research).
- Models other than Haiku 5.5. The production models were not called.
- `Image` and `Media` with real files. A frame cannot load the app's blob URLs, so bytes must be posted in.
