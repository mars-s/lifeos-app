# Canvas and AI-built Workflows in Notes

Researched on 28 November 2026 for Avi's ask: a canvas in Notes like Obsidian Canvas, where the AI can lay out runnable blocks and custom UI live, like ComfyUI, Blueprints or Blender nodes. The mock screens are at `/design/canvas` and described in [docs/design/canvas.md](../design/canvas.md).

## Verdict

1. **Possible, with what LifeOS already has.** A canvas is a note whose Y.Doc holds cards and links. A run is a Job. The AI builds it through tools in the one registry. No new server.
2. **The catch: commands run only on the Mac app, and only while it is awake.** The web and the iPhone can see, edit, start and watch. A run started while the Mac sleeps waits in the queue.
3. **The hard part is safety, not the canvas.** AI-written shell commands on Avi's Mac need an approval given on that Mac, a sandbox that limits writes to one folder, and a Stop that kills everything. The sandbox is the least proven piece (Blender and Chromium inside Seatbelt need a spike).
4. **"Fully custom" UI is possible only sealed.** AI-written HTML runs in a frame with no network and no access to LifeOS. Its only effect is a typed value on a socket. LifeOS's own parts stay the default.
5. **The first slice is useful with no running at all:** a plain canvas of notes, Tasks and links that syncs and works offline. Running, the AI and custom blocks come after, each behind the safety work it needs.

## 1. Is it possible, and where does it run?

Yes. Each part maps onto something that exists:

| Part | Runs where | Built on |
| --- | --- | --- |
| The canvas (cards, links, positions) | Every device, offline, a full copy each | One Y.Doc per canvas through the Notes Relay, the same as a note (`docs/research/notes-sync.md`) |
| A run (which Step is running, progress, log tail) | Core | A Job of a new kind `workflow`, claimed by the Mac Worker (`docs/architecture.md`, Workers and Jobs) |
| The commands | The Mac app only | A runner in the Tauri app's Rust side. This is the AI design's slice 7, the Mac runner, with one more capability |
| The AI building the canvas | Core (the in-app agent), or the Mac (Claude Code with the MCP tools) | New tools in `tools.ts`, the existing run store, approval and undo (`docs/research/lifeos-ai.md`) |
| Big outputs (frames, films) | The Mac's disk | Nothing new. Only small previews leave the Mac (section 7) |

What each device can do:

| | See | Edit | Start a run | Run commands | Approve a new command |
| --- | --- | --- | --- | --- | --- |
| Mac | Yes | Yes | Yes | Yes, while awake | Yes |
| Web | Yes | Yes | Yes, for Steps already approved | No | No |
| iPhone | Yes | Yes | Yes, for Steps already approved | No | No |

**When the Mac sleeps.** A run started from the web or the iPhone is a queued Job. Nothing happens until the Mac wakes and its Worker claims it. The canvas says "Waiting for your Mac", never a spinner. If the Mac sleeps in the middle of a run, the Job's lease expires and the Job returns to the queue (the existing rule). On wake the run starts again and every finished Step is kept from the cache (section 3), so only the interrupted Step repeats. While a run is live the Mac app holds a power assertion so the Mac does not idle to sleep. Closing the lid on battery still sleeps it. An always-on runner could be added later as another Worker, as the architecture page already says for agents.

The honest limits:

- A browser tab can never run `Blender` or `ffmpeg`. This is not a gap to close later.
- A Claude Code Step inside a headless run cannot ask Avi a question. The `html-video` skill starts by agreeing a brief with the user, so the brief note must already carry the message, length, formats and sound. Expect a first pass that is worse than an interactive session, and plan for a pause after the preview (the Check card in section 8, slice 7).
- Renders take minutes to hours, and for that time the Mac is busy. The house rule from `afterburn` (`nice -n 19`, one scene at a time) carries over.

## 2. The canvas

### File format

[JSON Canvas 1.0](https://raw.githubusercontent.com/obsidianmd/jsoncanvas/main/spec/1.0.md) (11 March 2024, [MIT](https://raw.githubusercontent.com/obsidianmd/jsoncanvas/main/LICENSE)) is the open format behind Obsidian Canvas. It is two arrays:

- **Nodes** have `id`, `type`, `x`, `y`, `width`, `height` and an optional `color`. The four types are `text` (Markdown in `text`), `file` (a path, with an optional `subpath`), `link` (a `url`) and `group` (a `label`).
- **Edges** have `id`, `fromNode`, `toNode`, optional `fromSide` and `toSide` (top, right, bottom, left), `fromEnd` and `toEnd` (none or arrow), `color` and `label`.

The spec does not say whether extra fields or other node types are allowed. It is silent, so nothing can be assumed about how Obsidian treats them.

**Pick: use JSON Canvas as the shape of our model and as the import and export format, not as the stored format.** The stored copy is a Y.Doc, because a canvas must merge edits from three devices and a JSON file cannot. The mapping:

| LifeOS card | JSON Canvas on export |
| --- | --- |
| Note card | `file` node pointing at the note's Markdown |
| Text card | `text` node |
| Group | `group` node |
| Task chip | `link` node with a `lifeos://` URL |
| Step, View, Block | `text` node holding the title and the command, plus a `lifeos` field with the full card. Other apps see text. LifeOS reads the field back |
| Link | Edge with sides and label. A wire also carries `lifeos.fromSocket` and `lifeos.toSocket` |

### How it syncs

A canvas is a note with `kind: "canvas"`. It has its own row in the notes table, lives in the Area and Project tree, and has one Durable Object on the relay, like any note. The relay does not need to understand it: it passes Yjs updates and saves them merged. Only the searchable copy changes: for a canvas, the relay sends Core the title, the text of the cards and the entity references.

The Y.Doc:

- `cards`: a `Y.Map` keyed by card id. Each card is a `Y.Map` (`kind`, `x`, `y`, `w`, `h`, and the fields of its kind). A text card's body and a Step's command are `Y.Text`, so two devices typing in one card merge.
- `edges`: a `Y.Map` keyed by edge id, each a small `Y.Map`.

Nested shared types are a documented Yjs feature and `observeDeep` reports a change anywhere below ([Y.Map](https://docs.yjs.dev/api/shared-types/y.map)). A map of maps means two devices moving two different cards never conflict, and two devices moving the same card settle on one position. The Yjs docs do not spell out the tie-break for the same key, so the build should prove it with a two-client test, as `notes-sync.md` did for text.

Two things stay out of the Y.Doc on purpose:

- **Run state** (which Step is running, progress, logs). Only the Mac writes it, it changes many times a second, and Yjs keeps history. It lives in Core as rows the clients subscribe to.
- **Approvals and secrets.** These live on the Mac only (section 6). A document that syncs must never be able to mark a command as approved.

Dragging sends many small updates. The existing path already fits: a device sends within about 30 ms and the relay saves at most one merged row a second.

### Which library

| Library | Licence | Size | Touch | Yjs | Verdict |
| --- | --- | --- | --- | --- | --- |
| **React Flow** (`@xyflow/react` 13.0.3) | [MIT](https://github.com/xyflow/xyflow/blob/main/packages/react/package.json). The docs ask that the small attribution stays [unless you subscribe to Pro](https://reactflow.dev/learn/troubleshooting/remove-attribution) | 1.3 MB unpacked. About 87 KB gzip for the flow, background and controls (my own esbuild measure, not a published figure) | Pinch to zoom and drag to pan are on by default ([API](https://reactflow.dev/api-reference/react-flow)). Connecting works by [tapping two handles](https://reactflow.dev/examples/interaction/touch-device) | No free binding. The [collaborative example](https://reactflow.dev/examples/interaction/collaborative) is a Pro example. Nodes and edges are plain controlled state, so our own binding is about 100 lines | **Pick** |
| tldraw 5.6.2 | [Its own licence](https://raw.githubusercontent.com/tldraw/tldraw/main/LICENSE.md): free in development, a key for production. The free [hobby licence](https://tldraw.dev/community/license) shows a "made with tldraw" watermark, and the SDK pings tldraw's servers | 15.7 MB unpacked | Very good | Its own engine, [tldraw sync](https://tldraw.dev/docs/sync). The official Yjs example is gone | No. A licence key, a watermark and a second sync engine, for a whiteboard we would then have to turn into a node graph |
| Excalidraw 0.18.1 | [MIT](https://github.com/excalidraw/excalidraw) | 46.8 MB unpacked | Good | Its own | No. A hand-drawn whiteboard. Cards cannot be our React components |
| litegraph.js | MIT for the [original](https://github.com/jagenjo/litegraph.js). ComfyUI's fork is [archived](https://github.com/Comfy-Org/litegraph.js) and now lives inside the GPL-3.0 [ComfyUI frontend](https://github.com/Comfy-Org/ComfyUI_frontend) | 3 MB unpacked | Weak | None | No. It draws on a 2D canvas, so no Task chips, no note text, no accessibility tree |
| Rete.js 2.0.6 | [MIT](https://github.com/retejs/rete) | 226 KB unpacked | Fair | None | No. It bundles a dataflow engine for the browser. Our engine runs on the Mac, not in the view |
| Our own (the mock's `stage.tsx`) | Ours | About 200 lines | Pan only | Ours | Good enough for the design board. The real one would have to add connecting by drag, pinch, box select, keyboard moves and drawing only what is on screen, which is what React Flow is |

React Flow renders each node as a React component, so a note card, a Task chip with the real checkbox and a Step are our own components with the LifeOS look. React 19 installs against it with no peer conflict.

**iPhone.** No maintained native node-canvas library for React Native turned up. The route that costs least is the one Notes already took for the editor: the same web canvas inside an [Expo DOM component](https://docs.expo.dev/guides/dom-components/), a peer of the Hermes Y.Doc over the bridge that exists. The iPhone canvas is for looking, moving, adding a note and pressing Run. Building a long workflow on a phone is not a goal.

## 3. The node model

| System | Model | What to take | What to leave |
| --- | --- | --- | --- |
| **ComfyUI** | A graph of typed nodes with no cycles. Each node declares `INPUT_TYPES` and `RETURN_TYPES` ([docs](https://docs.comfy.org/custom-nodes/backend/server_overview)). Runs start from the output nodes and work backwards, in topological order with cycle detection ([graph.py](https://raw.githubusercontent.com/comfyanonymous/ComfyUI/master/comfy_execution/graph.py)). It "caches outputs, and only executes nodes that might produce a different result than the previous run". Runs wait in a queue, and progress arrives over a websocket as `executing`, `progress` (value, max), `executed` and `execution_error` ([messages](https://docs.comfy.org/development/comfyui-server/comms_messages)) | The whole execution model: pull from what you asked for, run in order, keep what did not change, one queue, progress as small events | A registry of hundreds of node classes and a zoo of socket types |
| **Unreal Blueprints** | Two kinds of wire. Exec wires say when an impure node runs. Data wires carry values, and pure functions "are wired to Data Pins and are automatically executed" ([docs](https://dev.epicgames.com/documentation/en-us/unreal-engine/functions-in-unreal-engine)) | The idea that pure nodes need no order | Exec pins. They exist for loops, branches and side effects ordered in time. A second kind of wire doubles what Avi must read |
| **Blender nodes** | Data only. Geometry flows from Group Input to Group Output ([manual](https://projects.blender.org/blender/blender-manual/raw/branch/main/manual/modeling/geometry_nodes/introduction.rst)). Sockets are typed and told apart at a glance | Typed sockets you can read without a legend | Colour as the type code. LifeOS keeps colour for Areas, so sockets differ by shape |

**Pick: ComfyUI's model with one node type.** No exec pins, no loops, no branches.

- **A Step is one command.** It has a title, a command, typed inputs, typed outputs and a working folder. There is no library of node kinds. "Random number" is one Step, `shuf -i 1-100 -n 1`, with one number output. That is what "nothing hardcoded" means here.
- **Four socket types:** text, number, file, folder. A wire joins two sockets of the same type. Text and number outputs are the command's standard output. File and folder outputs are paths the Step declares, checked to exist after it exits with 0.
- **Order comes from the wires.** Pressing Run on a Step runs everything upstream of it first, in topological order. A cycle is refused when the wire is drawn. Steps with no path between them may run side by side later. The first version runs one at a time.
- **Kept, not run again.** A Step's key is a hash of its command, its inputs' values, and for files the size and modified time (a content hash for small ones). If the key matches the last good run and the outputs still exist, the Step is kept. A Step can be marked "always run" for commands like `shuf`, which is ComfyUI's `IS_CHANGED` escape hatch.
- **Progress and logs.** A Step may give a pattern that reads progress from its output (`Fra:(\d+)` with a known total for Blender). With none, it shows running with no figure. The last 50 lines go to Core. The whole log stays in the run folder on the Mac.
- **Values never become shell text.** An input reaches the command as an environment variable and the command refers to it by name. A value from a note, a custom block or an earlier Step is never pasted into the command string, so it cannot inject one.

**Notes and Tasks on the same canvas.** Cards come in two families. Plain cards (note, text, Task chip, group) link freely, side to side, with a label: that is the Obsidian half. Wired cards (Step, View, Block) have sockets. The two meet in one place: a note or a text card wired into a text input gives its text as the value, which is how the brief reaches the first Step. A Task chip on a canvas is the real Task. In the first version a Step cannot change a Task.

A **View** is a wired card with only inputs: it shows a file, a folder's latest frame, a number or text. It is the "render preview node".

## 4. The AI builds it live

Six new tools in the one registry (`tools.ts`), so the in-app agent and Claude Code over MCP share them:

| Tool | Does | Asks first? |
| --- | --- | --- |
| `canvas_read` | Returns the cards and links | No |
| `canvas_add_card` | Adds a note, text, Task, group, Step, View or Block card at a place | No. It is drawn in pencil |
| `canvas_set_step` | Sets a Step's title, command, sockets and folder | No. Changing a command clears its approval |
| `canvas_connect` | Adds a link or a wire. Refuses a cycle or a type mismatch | No |
| `canvas_remove` | Removes a card or a link | No, when the run added it. Yes for a card Avi made |
| `canvas_run` | Starts a run of a Step and what is upstream | **Always**, for any Step not yet approved on the Mac |

How it appears live: the agent runs in a Convex action and the canvas is on the relay. Each tool call loads the canvas's state from the relay, applies the change with Yjs in the action (Yjs is plain JavaScript) and posts the update back, through the relay's existing `POST /notes/<id>/sync` with a Worker token. Every open device gets the update over its websocket within the usual few milliseconds, so cards and wires arrive one by one as the tool calls land.

**Pencil.** A card or link the run added carries the run's id and is drawn in pencil (dashed, no shadow), the same pencil the AI design uses for drafts. Keep removes the mark. "Undo all" removes everything carrying the run's id and restores anything the run changed from the inverse saved in Activity. It is one undoable run, like any other.

**The video pipeline as Steps**, read from the two skills:

| Step | Command | In | Out |
| --- | --- | --- | --- |
| Write the film | `claude -p "/astack:html-video …"` | brief (text, from a note) | film (folder) |
| Render the preview | `node render.mjs film/index.html --all` | film | preview.mp4 (file) |
| Intake | `node intake.mjs film/index.html` | film | handoff (folder: beats, cues, stills, layers) |
| Write the scenes | `claude -p "/astack:afterburn …"` | handoff | scenes (folder of Blender scripts) |
| Render the frames | `nice -n 19 Blender -b -P scenes/shot.py` | scenes | frames (folder) |
| Soundtrack | `node tools/soundtrack.mjs handoff/cues.json` | handoff | track (file) |
| Assemble | `tools/assemble.sh frames track film.mp4` | frames, track | film.mp4 (file) |

Change the brief and everything runs. Change only the sound cues and only Soundtrack and Assemble run. The rest is kept. That is the real win over running the skills by hand.

**A Step that calls a skill.** [Claude Code's headless mode](https://code.claude.com/docs/en/headless) fits: `claude -p` exits 0 on success, expands a `/skill-name` in the prompt, and loads skills and plugins as the interactive app does.

- **Flags a Step sets:** `--output-format stream-json --verbose` for live progress, `--allowedTools` and `--permission-mode` so it never stops at a prompt, `--max-turns` and `--max-budget-usd` as hard caps ([CLI reference](https://code.claude.com/docs/en/cli-reference)).
- **Cost.** By default it uses the subscription login, and the JSON result reports `total_cost_usd`, which the Step shows when it finishes. One trap: "In non-interactive mode (-p), the key is always used when present" ([authentication](https://code.claude.com/docs/en/authentication)). The runner must strip `ANTHROPIC_API_KEY` from a Step's environment, or a Step bills the API key and not the subscription. A second trap: `--bare` skips skills and the subscription login and "will become the default for -p in a future release", so the Step must pin its flags and the check script must catch the change.
- **Risk.** A Claude Code Step is an agent with a shell. Its `--allowedTools` list is one fence. The sandbox around the whole Step (section 6) is the real one. A headless agent also checks its own work, where the skills say "done when you have looked at every still". So put a View after the preview and let Avi look before the long Blender Steps run.

## 5. Custom blocks (GenUI)

| | LifeOS parts | A sealed frame of AI-written HTML |
| --- | --- | --- |
| What the AI sends | Data: a part name and its fields | A page: HTML, CSS and script |
| Look | Always the LifeOS look, both themes, reduced motion, screen readers | Whatever it wrote. We hand it the tokens and hope |
| Devices | Web, Mac and iPhone, as native as each allows | Web and Mac. On iPhone only inside the DOM component |
| Risk | None beyond bad data | A hostile page, held only by the frame |
| Can do | What the vocabulary has | Anything a page with no network can do |

**Pick: a mix, parts first.** A View card draws its input with a LifeOS part (text, number, table, image, video still, Task tile, day meter). The AI reaches for a custom Block only when no part fits, such as "pick the poster frame from these stills".

**The security line for a Block:**

1. It runs in `<iframe sandbox="allow-scripts" srcdoc="…">` and nothing more. Without `allow-same-origin` the page is "treated as being from a special origin that always fails the same-origin policy" ([MDN](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe)): no cookies, no storage, no Convex token, no reach into the app. The mock's check script proves the page cannot read the frame's document and the frame still works.
2. A Content Security Policy of `default-src 'none'` with inline script and style only. No fetch, no images from the web, no fonts from the web. It cannot send anything anywhere.
3. It talks to the canvas through `postMessage` only: the host sends its input values and the theme tokens, and it sends `{ output, value }`. The host checks the sender is that frame, checks the value against the socket's type, and never runs anything it receives.
4. The value it sends is as untrusted as a web page. It reaches a command only as an environment variable (section 3).
5. Its HTML is capped (64 KB) and stored in the canvas as text, so Avi can read it and undo it.

This is stricter than [MCP Apps](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/draft/apps.mdx), which requires `allow-same-origin` on a separate origin. We have no second origin in a Tauri app, so we go without it.

**One thing to prove before building:** Tauri says its API "is only accessible to bundled code" by default, and warns that on Linux and Android it cannot tell an embedded frame from the window ([capabilities](https://v2.tauri.app/security/capabilities/)). macOS is not on that list, but whether a sealed frame can reach Tauri's IPC is not documented. The Block slice starts with a test that `window.__TAURI_INTERNALS__` is undefined inside the frame and an `invoke` from it fails. If it does not fail, Blocks on the Mac are drawn in a separate webview with no capabilities.

## 6. Safety

The rule that carries the rest: **a command never runs on the Mac unless Avi approved that exact command on that Mac.**

1. **Where commands run.** In the Mac app's Rust side, started by a Job from Core. The webview gets no shell at all: `tauri-plugin-shell` stays out of the capabilities ("By default all potentially dangerous plugin commands and scopes are blocked", [docs](https://v2.tauri.app/plugin/shell/)). A custom block or a web page cannot ask the Mac to run anything.
2. **Approval, fitting the existing policy.** Reads run. Canvas edits act and can be undone. Running a command cannot be undone, so `canvas_run` returns a `tool-approval-request` like Trash does today. The asking-first card lists every Step with its full command, its folder, the network it may reach and its cost cap. Each row can be unticked. Approval is saved on the Mac only, keyed by a hash of the command, folder, network list and secrets it needs. Any change to those, by the AI, by Avi on another device, or by a bad sync, clears it. The switch in Settings, AI, Runs that makes every change ask also makes every run ask, every time.
3. **Web and iPhone start, the Mac approves.** A run started elsewhere runs only Steps already approved on the Mac. Anything new waits as "Needs you on the Mac".
4. **Sandbox.** Each Step runs under macOS Seatbelt through Anthropic's [sandbox-runtime](https://github.com/anthropics/sandbox-runtime) (`srt`, Apache-2.0, a beta research preview), which Claude Code's own [sandbox](https://code.claude.com/docs/en/sandboxing) uses. Writes are allow-only: the workflow's folder and a temp folder. Reads are denied for `~/.ssh`, cloud credentials, Keychains, browser profiles, `.env` files and the LifeOS app's data. Network is denied unless the Step lists a host, through `srt`'s proxy. A Claude Code Step lists Anthropic's API and nothing else. Two honest caveats: `sandbox-exec` is marked [deprecated](https://man.freebsd.org/cgi/man.cgi?query=sandbox-exec&manpath=macOS) by Apple though it still ships and works, and Blender and Playwright's Chromium have not been tried inside it. That spike comes before any AI-written command runs. A Step that cannot work sandboxed can be approved to run outside it, with a louder card that says so.
5. **Working folders.** Each workflow has one folder, `~/LifeOS/Workflows/<canvas>/` unless Avi picks another. It is the working directory, every output path must resolve inside it after symlinks, and read access outside it is granted folder by folder (the skills folder, for one).
6. **Secrets never in the canvas.** A Step names what it needs (`ELEVENLABS_API_KEY`). The value comes from the Mac's Keychain when the Step starts, as an environment variable for that Step only. Granting a secret to a Step is part of its approval. Secret values are replaced with dots in any log line before it leaves the Mac. A Step starts with a small clean environment (`PATH`, `HOME`, `LANG`, `TMPDIR`), not Avi's shell.
7. **The kill switch.** Stop is on the run strip on every device. It marks the run as stopping in Core and the Mac ends the Step's whole process group (terminate, then kill after 5 seconds), so Blender, node and Chromium children die with it. Each Step starts in its own group for this. The Mac's tray menu has "Stop all runs". Turning the Workflows Feature off in Settings stops the Mac Worker from offering the capability at all.
8. **Limits.** One run at a time. A default 30 minute limit per Step, raised per Step for renders. A cap on log size. `--max-budget-usd` on every Claude Code Step.
9. **Prompt injection.** A note or a Saved Link can tell the agent to add a bad Step. It can only ever add it in pencil. The command is shown in full before it runs, a changed command is shown as a change, and the sandbox bounds what an approved mistake can touch.

## 7. Outputs

- **Big files stay on the Mac**, in the workflow's folder. Frames and films are never uploaded.
- **What syncs through Core:** each Step's state, progress figures, the last 50 log lines, and one small preview per output. A still is a 480 px image of about 50 KB. A film is a poster frame plus, if wanted, a 10 second 480p clip under 2 MB. The Mac makes them with `sips` and `ffmpeg`.
- **Where: Convex file storage.** The free plan has 1 GB of file storage and 1 GB a month of bandwidth ([limits](https://docs.convex.dev/production/state/limits)). Only the latest preview per output is kept and the one it replaces is deleted, so a workflow costs a few hundred kilobytes. A live render preview is one still at most every 10 seconds, and only while some device has the canvas open.
- **Not now: R2.** Cloudflare R2's free tier is 10 GB with no charge for egress ([pricing](https://developers.cloudflare.com/r2/pricing/)). It is the right home if Avi wants whole films on his phone, as a "Send to my phone" action later. It needs a bucket and signed links from the relay Worker, so it waits for the need.

## 8. Slices

Each one can be checked by itself, and the first three are useful with no AI.

1. **A canvas of notes.** A note of kind canvas in the Area tree, the Y.Doc shape, React Flow on web and Mac with note cards, text cards, Task chips, groups and labelled links. Pan, zoom, drag, undo, offline, live between two windows. JSON Canvas import and export. Check: a script that drags a card in one window and sees it move in the other.
2. **The canvas on iPhone.** The same canvas in a DOM component: look, move, add a note, tick a Task.
3. **Steps you write and run by hand.** A Step card with a command, sockets and a folder. The Mac runner (Rust, process groups, a clean environment), the `workflow` Job, approval on the Mac, state and log tail in Core, Stop everywhere. One Step at a time, no wires yet. Check: `shuf -i 1-100 -n 1` gives a number, and Stop ends a `sleep 600`.
4. **Wires, order and keeping.** Typed wires, topological order, the cache, progress patterns, View cards, previews in Convex storage. Check: change one input and only what is downstream runs.
5. **The sandbox and secrets.** The `srt` spike with node, Playwright, Blender and `claude`. Keychain secrets, redacted logs. Check: a Step that tries to read `~/.ssh` or write outside its folder fails.
6. **The AI builds it.** The six tools, pencil, the asking-first card, Undo all. It depends on slice 5. Check: "a workflow for a random number" builds one Step and asks before running it.
7. **Claude Code Steps and the film.** `claude -p` Steps with cost on the card and a budget cap, and a Check card that holds the run until Avi has looked. Then the real html-video and afterburn pipeline.
8. **Custom blocks.** The part vocabulary for View cards first, then the sealed frame, starting with the Tauri IPC test.
9. **Away from the Mac.** Start from the web and the iPhone, "Waiting for your Mac", a notification when a run finishes or needs him.

## Choices made for Avi

He was not asked. Each took the calmer option.

- **No exec pins, loops or branches.** One kind of wire. A loop can come later as "once per file in a folder".
- **React Flow, keeping its small attribution.** Paying for Pro removes it, if he minds it.
- **A canvas is a kind of note, not a third mode.** It sits in the Notes mode's tree from the Modes proposal in `docs/design/notes.md`. The run strip stays at the foot of the window in both modes, so a render can be watched from the Planner.
- **Approve on the Mac only.** Slower when he is out, safer always.
- **Parts first, custom blocks last.** Custom blocks are the last slice.
- **Previews in Convex, films nowhere.** R2 waits.
- **One run at a time.**
- **New words to add to `CONTEXT.md` when slice 1 is built:** Canvas, Card, Link, Step, Socket, Wire, View, Block, Workflow Run.

## Sources

- JSON Canvas: [spec 1.0](https://raw.githubusercontent.com/obsidianmd/jsoncanvas/main/spec/1.0.md), [licence](https://raw.githubusercontent.com/obsidianmd/jsoncanvas/main/LICENSE).
- React Flow: `npm view @xyflow/react`, [API reference](https://reactflow.dev/api-reference/react-flow), [touch](https://reactflow.dev/examples/interaction/touch-device), [attribution](https://reactflow.dev/learn/troubleshooting/remove-attribution), [collaborative example](https://reactflow.dev/examples/interaction/collaborative).
- tldraw: [README](https://raw.githubusercontent.com/tldraw/tldraw/main/README.md), [LICENSE.md](https://raw.githubusercontent.com/tldraw/tldraw/main/LICENSE.md), [licence page](https://tldraw.dev/community/license), [sync](https://tldraw.dev/docs/sync).
- Others: [Excalidraw](https://github.com/excalidraw/excalidraw), [litegraph.js](https://github.com/jagenjo/litegraph.js), [Comfy-Org/litegraph.js](https://github.com/Comfy-Org/litegraph.js), [ComfyUI frontend](https://github.com/Comfy-Org/ComfyUI_frontend), [Rete.js](https://github.com/retejs/rete), [Expo DOM components](https://docs.expo.dev/guides/dom-components/).
- ComfyUI: [server overview](https://docs.comfy.org/custom-nodes/backend/server_overview), [graph.py](https://raw.githubusercontent.com/comfyanonymous/ComfyUI/master/comfy_execution/graph.py), [routes](https://docs.comfy.org/development/comfyui-server/comms_routes), [messages](https://docs.comfy.org/development/comfyui-server/comms_messages).
- Unreal: [functions](https://dev.epicgames.com/documentation/en-us/unreal-engine/functions-in-unreal-engine). Blender: [geometry nodes introduction](https://projects.blender.org/blender/blender-manual/raw/branch/main/manual/modeling/geometry_nodes/introduction.rst).
- Claude Code: [headless](https://code.claude.com/docs/en/headless), [CLI reference](https://code.claude.com/docs/en/cli-reference), [authentication](https://code.claude.com/docs/en/authentication), [sandboxing](https://code.claude.com/docs/en/sandboxing).
- Sandbox: [sandbox-runtime](https://github.com/anthropics/sandbox-runtime), the [`sandbox-exec` man page](https://man.freebsd.org/cgi/man.cgi?query=sandbox-exec&manpath=macOS).
- Tauri: [shell plugin](https://v2.tauri.app/plugin/shell/), [capabilities](https://v2.tauri.app/security/capabilities/), [isolation](https://v2.tauri.app/concept/inter-process-communication/isolation/).
- Frames: [MDN iframe](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe), [MCP Apps draft](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/draft/apps.mdx).
- Storage: [Convex limits](https://docs.convex.dev/production/state/limits), [Convex pricing](https://www.convex.dev/pricing), [R2 pricing](https://developers.cloudflare.com/r2/pricing/).
- Yjs: [Y.Map](https://docs.yjs.dev/api/shared-types/y.map), [y-indexeddb](https://docs.yjs.dev/ecosystem/database-provider/y-indexeddb).
- The two skills, read on Avi's Mac: `astack` 0.2.0, `html-video/SKILL.md` and `afterburn/SKILL.md`.

Not confirmed from a primary source, and marked so above: how Obsidian treats unknown JSON Canvas fields, Yjs's tie-break for one key, whether a sealed frame can reach Tauri's IPC on macOS, and whether Blender and Chromium run inside Seatbelt. The last three each have a test in the slice that needs them.
