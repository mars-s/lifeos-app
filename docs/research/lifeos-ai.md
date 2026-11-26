# LifeOS AI: the agent engine, memory and the index

Researched and measured on 27 November 2026 for [#83](https://github.com/mars-s/lifeos-app/issues/83). Avi wants AI that lives inside Tasks and Notes, not a chatbot: press ⌘J, the line you are on lights up, a box rises under it and the answer streams in under your text. Behind it sits a real agent that loops, decides, acts through the same changes as the app, and remembers. This page picks the agent SDK, designs the memory and the index, and says what to build first.

## The choice

**The Vercel AI SDK 7 (`ai` 7.0.183) as the one engine, with Convex's Agent component (`@convex-dev/agent` 0.7.11) holding runs in Core.**

1. It is the smallest real engine: 3 dependencies, 11 packages and 24 MB installed, against Pi's 88 packages and 106 MB, and it bundles to 195 KB gzipped for a Worker or browser.
2. It runs everywhere LifeOS runs, unchanged: Convex actions, the Mac app's sidecar, Cloudflare Workers, the browser and React Native.
3. Approval is data, not a paused process: a write that needs Avi's OK comes back as a `tool-approval-request`, and the run resumes from saved messages, minutes or days later, in another action.
4. Its typed message parts (one per tool, plus `data-*` parts) are exactly the generative UI LifeOS wants: our own components render them on web, Mac and iPhone.
5. Convex's own guidelines point at the Agent component for this, and it is built on the AI SDK: saved threads, streaming to every device over the Convex websocket, tool approval and usage, with no new server.

**Runner-up: Pi** (`@earendil-works/pi-agent-core` 1.6.1). The nicest loop (steering, follow-ups, `beforeToolCall`), the widest provider list, and built-in subscription logins. It loses on size, on having no UI layer, and because the login it does best, a Claude subscription inside a third-party app, is one Anthropic forbids.

## Candidates

Versions, licences and dates from the npm registry on 27 November 2026. "Installed" is the core package's unpacked size on npm unless measured.

| SDK | Version, licence | What it is | Runs in Convex, Mac, Workers | Avi's subscriptions | Loops, approval, resume | Generative UI | Weight |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Vercel AI SDK** (`ai`) | 7.0.183 (26 Nov), Apache-2.0. Vercel, released almost daily | A model-agnostic toolkit: `generateText`/`streamText`, `ToolLoopAgent`, `WorkflowAgent` | Yes, yes, yes. React Native through `@ai-sdk/react` | Claude Code and Codex through community providers (`ai-sdk-provider-claude-code` 4.4.1, `ai-sdk-provider-codex-cli` 2.4.0) on the Mac. OpenAI, xAI and any OpenAI-compatible API (OpenCode Go) by key | `stopWhen`, `prepareStep` (pick tools and model per step), subagents as tools, `toolApproval` per tool or one policy, resume from messages. Durable runs with `WorkflowAgent` on the Workflow SDK | Typed tool parts and `data-*` parts in one UI message stream; `useChat` on React and React Native | **Measured: 11 packages, 24 MB, 195 KB gzipped** |
| **Pi** (`@earendil-works/pi-*`, was `@mariozechner/pi-*`) | 1.6.1 (25 Nov), MIT. Mario Zechner and Armin Ronacher, pi-mono has 124k stars, pushed 26 Nov | A unified LLM API (`pi-ai`) and a stateful agent loop (`pi-agent-core`), plus an experimental durable runtime (`pi-durable`) | Likely in Convex (not tried), yes, yes (bundles for `worker`) | Built-in OAuth for Claude Pro/Max, ChatGPT (Codex) and Copilot, with a credential store. OpenCode Go and xAI are built in | `beforeToolCall` and `afterToolCall`, steering and follow-up queues, `finishTurn` decisions. Approval waits on a promise inside the process. Durable resume only in `pi-durable`, marked "API changes without notice" | None. Tool results carry `details` we would map ourselves | **Measured: 88 packages, 106 MB (it pulls the OpenAI, Anthropic, Google and AWS SDKs), 298 KB gzipped** |
| **Vercel Eve** (`eve`) | 1.5.0 (25 Nov), Apache-2.0. Vercel | A filesystem-first framework for durable backend agents: `agent/instructions.md`, `tools/`, `skills/`, `channels/`, `schedules/`, built on the AI SDK, the Workflow SDK and Nitro | No (it is its own server), no, deploys to Vercel | AI Gateway model ids, or any AI SDK model | Durable runs, checkpoints, approvals, cron | Web Chat, Slack and other channels; not our components | 22.7 MB, its own build tool chain |
| **Claude Agent SDK** | 0.3.332 (24 Nov), Anthropic's commercial licence | Claude Code as a library: it drives the Claude Code binary | No, yes (Node), no | The only sanctioned way to use the Claude subscription from code, counted in its programmatic usage pool | Claude Code's loop, permission hooks, sessions | No | 5.2 MB plus the binary |
| **OpenAI Agents SDK** (`@openai/agents`) | 0.22.0 (12 Nov), MIT. OpenAI | Agents, handoffs, guardrails, tracing | Yes, yes, yes | Codex through the separate `@openai/codex-sdk` 0.172.0; other models through an AI SDK adapter | `needsApproval`, a serialisable `RunState` to resume | No | 4 dependencies, the `openai` client |
| **Mastra** (`@mastra/core`) | 1.86.0 (25 Nov), Apache-2.0 | A full framework: agents, graph workflows, memory, RAG, evals, its own server | Through its server, yes, partly | Through the AI SDK providers it wraps | Graph workflows with suspend and resume, approvals | Through the AI SDK | 30 dependencies, 42 MB core |
| **LangGraph.js** | 1.7.5 (17 Nov), MIT. LangChain | State graphs with checkpoints and `interrupt()` | Yes, yes, partly | Through LangChain model packages | Real graphs, checkpointers, interrupts, time travel | Through LangChain's UI kit | Needs `@langchain/core`, 4.6 MB |
| **Cloudflare Agents** (`agents`) | 0.34.1 (25 Nov), MIT | One Durable Object per agent: state sync, schedules, MCP | No, no, yes only | Through the AI SDK or Pi (both are peers) | Schedules and state; the loop is the AI SDK's or Pi's | Through the AI SDK | 11 dependencies, Workers only |
| **TanStack AI** | 1.8.0 (20 Nov), MIT | A typed AI SDK speaking the AG-UI protocol | Yes, yes, yes | Its own adapters | Tool loop and approvals, younger | AG-UI events | 7 dependencies |

Dropped quickly: VoltAgent (44 dependencies), the Convex RAG component for now (one table with a vector index is enough, below).

### What each one is good for in LifeOS

- **Engine (Core and the Mac): the AI SDK.** One `ToolLoopAgent` definition runs in a Convex action with API keys, and on the Mac with the subscriptions.
- **Claude Code and Codex: their own SDKs, on the Mac only.** Anthropic's terms allow the Claude subscription only in Claude Code and Anthropic's own apps and SDK, never as a login inside another app ([legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)). So the Claude subscription reaches LifeOS only as an `agent:claude` Job that the Mac runs with the Claude Agent SDK (or `ai-sdk-provider-claude-code`, which wraps it), talking to LifeOS's own MCP tools. Codex is the same with the Codex SDK. That is the runner the architecture already names.
- **Eve: a later cloud runner, if ever.** It is a framework you deploy, not a library you embed, so it cannot sit under the ⌘J box. Because it is built on the AI SDK, the same tools would move to it unchanged.
- **Graphs.** LangGraph and Mastra draw real graphs, but LifeOS's flows are short and plain TypeScript expresses them: `prepareStep` picks the next tools, a subagent is a tool, and a long plan is a chain of Jobs. If a run ever needs a real graph, the Workflow SDK (`WorkflowAgent`) is the AI SDK's own path.

## The spike

Two scratch projects outside the repo, Node 26.13 on Avi's MacBook. Each runs one loop with two fake LifeOS tools (`list_tasks`, a read, and `create_task`, a write), streams the answer as it comes, and asks for approval before the write. Both use their SDK's own fake model (Pi's `fauxProvider`, the AI SDK's `MockLanguageModelV4`), so no paid call was made. Both worked on the first run:

```
[tool] list_tasks -> {"tasks":[{"id":"t1","title":"Book dentist"}]}
You have one Task. Adding the reminder.
[approval] create_task {"title":"Buy floss"} -> approved
[tool] create_task -> {"part":"task-card","task":{"id":"t2","title":"Buy floss"}}
Done: Buy floss is in Today.
```

| | AI SDK 7.0.183 | Pi 1.6.1 |
| --- | --- | --- |
| Install (`ai`, `zod` 4, `@ai-sdk/openai-compatible`; Pi `pi-agent-core`, `pi-ai`, `pi-schema`) | **11 packages, 24 MB** | 88 packages, 106 MB |
| Bundle: the agent plus OpenCode Go and OpenAI, esbuild, minified, `browser`/`worker` | **842 KB, 195 KB gzipped** | 1,312 KB, 298 KB gzipped |
| Same, `node` | 854 KB, 199 KB gzipped | 1,700 KB, 413 KB gzipped |
| Spike code | 51 lines, about 40 without the fake model | 42 lines, about 32 without the fake model |
| How approval works | `toolApproval: { create_task: "user-approval" }`. The stream ends with a `tool-approval-request`; the caller adds a `tool-approval-response` message and calls again | `beforeToolCall` awaits a promise and returns `{ block: true }` to refuse |
| Survives the process ending while it waits | **Yes**: the wait is just saved messages | No: the promise lives in memory. Resume needs `pi-durable` (experimental) |

Pi needs less code because its loop holds state in memory. That is also why it is the wrong shape for Convex: an action cannot wait an hour for Avi to tap Approve. The AI SDK's extra lines are the outer loop that resends the messages with the answer, which is the part that makes a run resumable.

The heart of the AI SDK spike:

```ts
const agent = new ToolLoopAgent({ model, instructions, tools, stopWhen: stepCountIs(8), toolApproval: { create_task: "user-approval" } });

for (;;) {
  const result = await agent.stream({ messages });
  const approvals = [];
  for await (const part of result.fullStream) {
    if (part.type === "text-delta") render(part.text);
    if (part.type === "tool-approval-request") approvals.push(await ask(part));
  }
  messages.push(...(await result.response).messages);
  if (approvals.length === 0) break;
  messages.push({ role: "tool", content: approvals });
}
```

Not tested yet: either bundle inside a real Convex action. The Agent component runs the AI SDK in Convex's default runtime, so the AI SDK side is proven by others; it is the first thing slice 1 checks.

## One engine for ⌘J and the agent

There is one agent definition in the backend (`convex/ai/agent.ts`), one tool registry and one run store. ⌘J and a background agent are two modes of it, not two systems.

| | ⌘J (inline) | Agent run (background) |
| --- | --- | --- |
| Started by | ⌘J in a Task's notes, a Note, or on a selected Task | ⌘J "Do it" on a plan, a Template, a schedule, or an MCP client |
| Context | The line or block under the cursor, the Task or Note around it, the top hits from the index, pinned memories | The goal, the index, memories |
| Steps | Up to 4, fast model | Up to 30, the chosen model, chained across actions |
| Writes | **Proposals only**: text to insert, Tasks to create, a When to set, each rendered as a part Avi accepts with Enter. Accepting runs the change | Act on their own through `changeMutation`, with Undo. Risky ones wait for approval |
| Shown as | The box under the line, answer streaming in place (AffectUI's Inline Diff and Agent Cursors are the reference) | Agent Trail and Approval Gates in an Agent Inbox; never a chat |

How a run works:

- **Run store.** One Agent component thread per run, one Agent Run (a Job of kind `agent`) per thread, so Activity's actor stays `{ kind: "agentRun", jobId }` and "undo this run" already works (`docs/mcp.md`). The thread keeps the messages and tool steps; the Job keeps status and lease.
- **Streaming.** The action streams with `saveStreamDeltas`, so the answer reaches every open device through ordinary Convex queries, and a reload or a lost network picks it up where it was. The ⌘J box reads it with the component's `useUIMessages` hook. Throttle about 50 ms for ⌘J so it feels typed, not chunked.
- **Tools: one declaration, two doors.** Today each MCP tool is a `@convex-dev/mcp` `tool(...)` over an internal `agentQuery` or `agentMutation`. A small adapter turns each of those definitions into an AI SDK `tool()` (its JSON Schema through `jsonSchema()`), calling the same internal function with the run as actor. The in-app agent gets every MCP tool with no second copy, and every write still goes through `changeMutation`. External agents (Claude Code, Codex on the Mac, claude.ai, Grok) keep using the MCP door to the same functions.
- **Approval policy, declared per tool.** Reads run. Writes that one undo reverses run, and show Undo. These ask first: Trash, convert to Project, a run about to make more than 10 changes, and anything that cannot be undone. The policy is the `toolApproval` function, so Avi's Autonomy Dial later is one setting it reads.
- **Generative UI.** A tool's result carries a declared shape (it already does, `returns` in `docs/mcp.md`). The client maps the part name to our component: `tool-create_task` to a Task tile, `tool-get_day_plan` to the day meter, an approval request to an Approval Card, `data-proposal` to the inline accept row. Unknown parts fall back to a quiet one-line summary. The same mapping runs in the web app, the Tauri webview and, later, React Native.
- **Models.** The agent picks its model through the existing AI router (`ai/routing`), as a new Capability (`agent`, asks for `tools`). The Models registry gains a `tools` answer kind and Anthropic and xAI providers. The AI switch still means nothing is sent anywhere.
- **The Mac with subscriptions.** An `agent:claude` or `agent:codex` Job is claimed by the Mac Worker, which runs Claude Code or Codex with LifeOS's MCP server attached. Same tools, same Agent Run, same undo. Only the brain differs.

## Memory and the index

### The design

**One `aiIndex` table in Core with a Convex vector index, filled by OpenAI's `text-embedding-3-small` at 512 dimensions, searched together with Convex full-text search. Memories are a separate `memories` table that Avi can see and delete.**

### What gets indexed

| Source | What is embedded | When |
| --- | --- | --- |
| Tasks | Title, notes (first 1,000 characters), Checklist titles, Area and Project names | After a change, debounced 30 s, only if the text hash changed |
| Projects and Areas | Name and notes | Same |
| Notes | Each section of the note (split at headings, about 300 to 500 words), from the searchable copy the Notes Relay sends Core | When the note goes quiet (the relay already sends Core its copy then) |
| Saved Links | Title, summary and the extracted text's first chunks | When the `index:link` Job finishes |
| Activity | Not row by row. One "what happened" summary per day, written by a nightly Job | Nightly |
| Memories | Each fact | When written |

One table keeps one search across everything:

```
aiIndex: entity (table and id), kind, chunk, text (a 300-character snippet), areaId?, hash, embedding (512 floats), updatedAt
  vector index by_embedding: filter fields kind, areaId
  search index by_text: on text, filter kind, areaId
  index by_entity: for re-indexing and deleting
```

Search runs in an action: vector search and full-text search together, merged by reciprocal rank (each hit scores `1 / (60 + rank)` in each list), then hydrated through one internal query that drops anything trashed or deleted. That is the `search` the agent calls and the one the ⌘J box uses for context. With AI off, full-text search still works and no embedding is ever made.

Notes stay local-first. Core holds a section's vector and a short snippet, never the whole note. When the agent needs a note's full text it calls a `read_note` tool that asks the Notes Relay with Core's Worker token, the same way devices catch up. A deleted note deletes its rows. Embeddings can leak some of their text, so they sit inside the same trust line as the data (Core), never in a third service.

### Why not the others

| Option | Verdict |
| --- | --- |
| **Convex vector search** | **Chosen.** No new service, on the free plan, filter by kind and Area, and the agent runs in Core anyway |
| On-device vectors (sqlite-vec in the Mac and iPhone, a JS index on the web) | Not now. Three stores to build and keep in sync, and ⌘J needs the network for the model anyway, so local search saves nothing yet. The door stays open: the Mac can serve `index:*` Jobs with a local model later |
| Local model (gte-small, bge-small through transformers.js) | Not now. About 34 MB per device for the quantised model, it cannot run in Convex's default runtime, and every device must use the exact same model or the vectors do not compare |
| Apple's on-device embeddings | Apple devices only, so the web app and Core cannot make matching vectors |
| **`text-embedding-3-small`, 512 dimensions** | **Chosen.** $0.02 per million tokens; indexing everything Avi has (about 20,000 chunks of 100 tokens) costs about 4 cents once, and a ⌘J query costs a fraction of a cent. 512 dimensions keeps most of its quality and a third of the storage of 1,536. It is called through the AI router with the OpenAI key LifeOS already holds |

### Free plan fit

Convex's free plan has 0.5 GB of database storage and 0.5 GB of search storage, which covers vector indexes (third-party listings, November 2026; check `convex.dev/pricing`). 20,000 chunks at 512 floats is about 80 MB as documents (64-bit floats) and about 40 MB in the vector index. That fits with room to spare. The guard: stay at 512 dimensions, embed Activity by day not by row, and count `aiIndex` rows on the AI settings page. Past 50,000 chunks, drop to 256 dimensions (the same model, no new provider) or move to the Professional plan.

### Long-term memory: what the agent learns about Avi

- **Where.** A `memories` table in the `ai` module, apart from his data: `text` ("Prefers deep work before 11"), `kind` (preference, routine, person, place, goal), `source` (the Agent Run, or "Avi said so"), `pinned`, `lastUsedAt`, `createdAt`. Its embedding lives in `aiIndex` like everything else.
- **How it is written.** Only through a `remember` tool, in a `changeMutation`, so it shows in Activity and one undo removes it. The agent may remember only what Avi said or did, never a guess about him, and never secrets or health details unless he asks. Each new memory shows as a small chip under the answer: "Remembered: deep work before 11 · Undo".
- **How it is used.** Pinned memories plus the 5 closest to the request go into the prompt in their own labelled block, separate from his data. The model is told they are notes about Avi, not instructions.
- **Shown and forgotten.** Settings, AI, Memory lists every memory with where it came from, and Avi can edit, pin or forget each one, or forget all. Forgetting really deletes the row and its vector; the Undo toast holds the text on his device for a few seconds, and Activity keeps only that a memory was forgotten, never its text. A Memory switch turns writing and using memories off without touching the rest of AI.
- **Who can see them.** LifeOS's own agent. External MCP clients do not get a memory tool unless Avi grants a new `lifeos:memory` scope.

## Risks

- **The AI SDK moves fast.** v5 in 2025 to v7 in 2026, each with breaking changes. Keep it behind the tool adapter and the one agent file, so an upgrade touches two files.
- **The Agent component is 0.x.** If its threads do not fit Agent Runs, the fallback is the plain `ToolLoopAgent` from the spike with our own steps table and delta table, which is what the component does inside.
- **Subscription terms.** Anthropic allows the Claude subscription only through Claude Code and its own SDK, and counts SDK use in a separate programmatic pool. Codex sign-in through third-party tools is tolerated today, not promised. Keys (OpenAI, OpenCode Go, xAI) stay the always-on path; subscriptions are the Mac's bonus.
- **Prompt injection.** A Saved Link or a pasted note can carry instructions. Indexed text is wrapped as data in the prompt, the risky tools ask first, and every change can be undone, so the worst case is a reversible change Avi sees.
- **Action limits.** A Convex action stops after 10 minutes. Long runs save after each step and continue in a new action, which the saved thread already allows.
- **Cost drift.** Every run records tokens and the model that answered (`answeredBy`), and the AI settings page shows the month's spend.
- **The free plan.** Vector and document storage, above. One index table with small vectors keeps it well inside.

## First slices

1. **The engine in Core.** Add `ai` 7 and `@convex-dev/agent`. The `agent` Capability and the `tools` answer kind in the registries. The adapter from MCP tool definitions to AI SDK tools. One run as an Agent component thread plus an Agent Run Job. The approval policy. Tested with `MockLanguageModelV4` through `api`, no model calls. Check the bundle runs in Convex's default runtime first.
2. **⌘J on a Task.** In a Task's notes on web and Mac: the line lights up, the box rises, the answer streams in, proposals as parts accepted with Enter, Esc to close, everything undoable. Design pass with the AffectUI Inline Diff and Agent Cursors references, light and dark.
3. **The index.** `aiIndex` with vector and full-text search, the embedding call through the AI router, indexing for Tasks, Projects and Areas, the hybrid `search` tool, and ⌘J using it for context. Update `docs/data-model.md`: Notes and Saved Links use `aiIndex` instead of their own `embedding` fields.
4. **Memory.** The `memories` table, the `remember` and `forget` tools, the chip, and Settings, AI, Memory.
5. **Agent runs you can see.** Agent Inbox with Agent Trail and Approval Gates, Undo for a whole run (the Agent Run screen `docs/mcp.md` says is missing).
6. **⌘J in Notes,** once the Notes module lands: section indexing from the relay's searchable copy and the `read_note` tool.
7. **The Mac runner.** `agent:claude` and `agent:codex` Jobs claimed by the Mac Worker with the LifeOS MCP server attached.
8. **iPhone.** The same parts rendered in React Native.

## For Avi to decide

- **Anthropic models in Core.** Claude in the Convex agent needs an Anthropic API key (paid per call); the subscription only works through Claude Code on the Mac. Until then the in-app agent uses the OpenAI and OpenCode Go keys LifeOS already holds. Recommended: start without it.
- **Autonomy.** The default above (reversible writes act and show Undo; Trash, Project conversion and big batches ask) follows "agents act on their own and every change can be undone". If Avi wants every write to ask at first, that is one setting.

## Sources

- npm registry, 27 November 2026: `ai`, `@ai-sdk/openai-compatible`, `@ai-sdk/react`, `@ai-sdk/xai`, `@earendil-works/pi-ai`, `@earendil-works/pi-agent-core`, `@earendil-works/pi-durable`, `eve`, `@anthropic-ai/claude-agent-sdk`, `@openai/agents`, `@openai/codex-sdk`, `@mastra/core`, `@langchain/langgraph`, `agents`, `@tanstack/ai`, `@voltagent/core`, `@convex-dev/agent`, `@convex-dev/rag`, `ai-sdk-provider-claude-code`, `ai-sdk-provider-codex-cli`, `@huggingface/transformers`, `sqlite-vec`.
- AI SDK 7 docs shipped in the package: `docs/03-agents/06-tool-approvals.mdx`, `07-workflow-agent.mdx`, `10-eve.mdx`; [ai-sdk.dev](https://ai-sdk.dev/docs).
- Pi: [badlogic/pi-mono](https://github.com/badlogic/pi-mono), the READMEs of `packages/ai`, `packages/agent` and `packages/durable`.
- Eve: [vercel/eve](https://github.com/vercel/eve) and [eve.dev](https://eve.dev/docs).
- Convex: `packages/backend/convex/_generated/ai/guidelines.md` (vector search, the Agent component), [get-convex/agent](https://github.com/get-convex/agent) docs `tool-approval.mdx` and `streaming.mdx`, [limits](https://docs.convex.dev/production/state/limits), [pricing](https://www.convex.dev/pricing).
- Anthropic: [Claude Code legal and compliance](https://code.claude.com/docs/en/legal-and-compliance); [The Register, 20 Feb 2026](https://www.theregister.com/2026/02/20/anthropic_clarifies_ban_third_party_claude_access); [The Register, 14 May 2026](https://www.theregister.com/ai-ml/2026/05/14/anthropic-tosses-agents-into-the-api-billing-pool/5240748).
- OpenAI: [text-embedding-3-small](https://developers.openai.com/api/docs/models/text-embedding-3-small).
