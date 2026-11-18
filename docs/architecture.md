# LifeOS architecture: core, modules and workers

Decided with Avi on 18 November 2026. LifeOS is a whole life OS, not only a planner. Tasks and planning come first, then notes, saved links and in-app agents. This page fixes the shape every module plugs into, so later modules do not force a rewrite.

## The three places things run

| Place | What it is | What runs there |
| --- | --- | --- |
| **Core** | Hosted Convex (free tier), reachable from anywhere | The live app data: Tasks, Areas, Projects, planning, Activity, the Job queue, and searchable indexes of notes and saved links. Every client and the MCP connector talk to it. |
| **Home Server** | One thin LXC container on Avi's Proxmox box, on his Tailscale network, with the 2 TB SSD | Always-on Workers: in-app agents using Avi's Claude and ChatGPT subscriptions (Claude Code and Codex logged in inside the container), link indexing (a small embedding model, plus the OpenAI API for classification), the always-on Notes peer and archive, and large files. Keep it thin: Node, the two agent CLIs, Tailscale, nothing else. |
| **Mac app** | Tauri on Avi's MacBook | The Things Worker (Things 3 scripting only works on the Mac), trackpad haptics, a Notes peer, and a fallback agent runner when the Home Server is down. |

Clients (web, Mac, iPhone) read and write Core. They never depend on the Home Server being up, except for notes edited on another device, which merge when the peers meet.

## Workers and Jobs: one pattern for all background work

Anything that must happen outside Convex is a **Job** in Core, claimed by a **Worker**:

- A Job has a kind, a payload, an idempotency key, a status (queued, claimed, done, failed), a lease with a heartbeat, an attempt count, and a result or receipt.
- A Worker registers what it can do (for example `things`, `agent:claude`, `agent:codex`, `index:link`), subscribes to queued Jobs it can handle, claims one with a lease, heartbeats while working, and reports a result. An expired lease returns the Job to the queue.
- Things Operations, agent runs, link indexing and note archiving are all Job kinds. There is one queue, one claim rule and one retry rule, so a new module adds a Job kind, not a new queue.
- Workers authenticate with a scoped machine token per Worker, stored in that machine's keychain or secret store. Convex keeps only its hash.

## Agents

- **Runners**: agents run in a Worker on the Home Server, using Claude Code or Codex with Avi's subscriptions. The Mac app can run them too. A cloud runner (Vercel Eve or similar, paid per API call through an AI gateway) can be added later as another Worker, with no change to Core.
- **Power**: agents act on their own and every change can be undone. An agent changes data through the same mutations as the UI, with the actor recorded as that agent run. Activity keeps the inverse of every change, so a whole run can be undone in one step. A change to a Things-owned field still goes through the Things queue, so undoing it queues the inverse change.
- **Generative UI**: agents answer with structured results rendered by our own components. The AffectUI library in `docs/design/references/affectui/` is the inspiration.

## Modules

A module is one area of the life OS: Planner (Tasks, Areas, Projects), Calendar, Notes, Saved Links, Agents, and later Health or a Journal. Each module owns:

- its tables in the one Convex schema, in its own folder under the backend, with names prefixed only where they would clash,
- its view queries and mutations,
- its MCP tools for agents,
- its Job kinds and Worker handlers,
- its screens and a sidebar entry on each client.

Modules share these primitives instead of reinventing them:

- **Areas** span modules: a note or saved link can belong to an Area just like a Task.
- **Entity references**: one typed reference shape (Task, Project, Area, Note, Saved Link, Work Block, External Commitment) so anything can link to anything, with backlinks.
- **Activity**: every change in every module, with actor and inverse, for undo, history and visualisations.
- **Labels** and **search**: one search that every module feeds.
- **Jobs**: the queue above.

Modules live in the main Convex app, not as Convex components. Components isolate tables, which would block cross-module links, shared Activity and one search. Components stay for third-party pieces such as the MCP server.

## Notes: local-first

Notes are local-first, like Anytype. The Mac, the iPhone and the Home Server each keep a full copy and can edit offline. Edits merge automatically with a CRDT (Loro, Automerge or Yjs; choose in a dedicated spike). The Home Server is the always-on peer and the archive on the 2 TB SSD. Peers sync directly over Tailscale, and Core can relay changes between peers that cannot reach each other.

Core keeps only a searchable projection of each note (title, Area, entity references, a short excerpt and an embedding) so Tasks, search and agents can link to notes without holding the documents.

## Saved Links

Pocket or mymind style. Capturing a URL creates a Saved Link in Core at once. An `index:link` Job on the Home Server fetches the page, extracts the text, embeds it with a small local model, classifies it (the OpenAI API is allowed for this) and stores the full content and screenshots on the SSD. Core keeps the title, summary, labels, Area and embedding for search.

## What this means now

The data model slice builds the shared primitives (Activity with actor and inverse, entity references, Jobs and Workers, module folders) even though only the Planner uses them at first. Notes, Saved Links and agents arrive as modules later without schema rewrites.
