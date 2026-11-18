# LifeOS app

A calm place to plan the day. One Convex backend serves a web app, an iPhone app, a Mac app and a remote MCP connector for Claude and Grok.

![The Today view on the web: a star, a greeting with the date, and three quiet tasks on a warm off-white page.](docs/assets/today-web.png)

<img src="docs/assets/today-iphone.png" alt="The same Today view on an iPhone 17 Pro in the iOS Simulator." width="280" />

This repo replaces the old LifeOS ([`mars-s/lifeos`](https://github.com/mars-s/lifeos)). Things 3 stays the canonical task store and Apple Calendar stays the calendar source. Convex mirrors them so every surface reads the same data.

## Layout

| Path | What it is |
| --- | --- |
| `packages/backend` | Convex schema and functions, the MCP server, and shared helpers. The schema is the single source of types for the whole repo. |
| `apps/web` | Waku 1.0 RC. `ConvexProvider` lives in a `'use client'` component mounted from the root layout. |
| `apps/mobile` | Expo SDK 58 with Expo Router, ExpoKit components and `convex/react`. iPhone first. |
| `apps/desktop` | Tauri 2. Wraps the static web build. |
| `docs` | Design notes, starting with the [MCP connector](docs/mcp.md). |

It is a plain pnpm workspace. There is no Turborepo.

## Stack

- TypeScript `strict` everywhere, on TypeScript 6.0 (the version Expo SDK 58 pins).
- `neverthrow` for expected errors. Results cross the server/client boundary as plain `{ ok, value }` or `{ ok, error }` objects, then become `Result`s again on the client. See `packages/backend/shared/result.ts`.
- oxlint with `@interfere/landmines`.
- shadcn/ui on Tailwind 4 for web, with a calm theme: warm off-white backgrounds, soft grey text and low-contrast borders. Tokens live in `apps/web/src/styles.css`.
- [ExpoKit](https://expokit.in) for iPhone UI, with the same calm palette set once in `apps/mobile/src/lib/kit-theme.tsx`.
- Rust follows [BeautifulRust](https://github.com/morganlinton/BeautifulRust), with its strict clippy config.
- Inter and Lucide icons on every surface.

Planned UI libraries, not installed yet. Add each one with the view that needs it:

- [Origin UI](https://originui.com) for richer shadcn-compatible components.
- [Schedule-X](https://schedule-x.dev) with its shadcn theme, for calendar timeboxing.
- [dnd-kit](https://dndkit.com) for drag and drop between lists and onto the calendar.
- [cmdk](https://cmdk.paco.me) for the command palette and quick capture.
- [Motion](https://motion.dev) for small, calm transitions.

## First run

You need Node 22.18 or later, pnpm 10, and Rust for the Mac app.

```sh
pnpm install
```

### 1. Create the Convex deployment (once, needs your browser)

```sh
cd packages/backend
npx convex dev
```

Sign in when it asks, and create a new project called `lifeos-app` on the free tier. Leave it running: it watches `convex/` and regenerates `convex/_generated`. It writes the deployment URL to `packages/backend/.env.local`.

Add sample tasks for today:

```sh
npx convex run tasks:seedSample "{\"date\":\"$(date +%F)\"}"
```

### 2. Point the apps at it

Copy the `.convex.cloud` URL that `npx convex dev` printed.

```sh
echo "WAKU_PUBLIC_CONVEX_URL=https://<deployment>.convex.cloud" > apps/web/.env.local
echo "EXPO_PUBLIC_CONVEX_URL=https://<deployment>.convex.cloud" > apps/mobile/.env.local
```

### 3. Run a surface

```sh
pnpm dev:web       # http://localhost:3000
pnpm dev:mobile    # then press i for the iOS Simulator
pnpm dev:desktop   # starts the web dev server and opens the Mac app
```

## Commands

| Command | What it does |
| --- | --- |
| `pnpm check` | oxlint, clippy, typecheck every package, build the web app. |
| `pnpm lint` | oxlint with landmines. |
| `pnpm lint:rust` | rustfmt check and clippy with BeautifulRust's lints, warnings as errors. |
| `pnpm typecheck` | `tsc` in each package. |
| `pnpm build` | Static web build into `apps/web/dist/public`. |
| `pnpm build:mobile` | Bundle the iPhone JavaScript with `expo export`. |
| `pnpm build:desktop` | Build `LifeOS.app` with Tauri. |

## Convex codegen

`packages/backend/convex/_generated` is committed, so everything typechecks before you have a deployment. It was generated with Convex's anonymous local mode, which needs no account:

```sh
cd packages/backend
CONVEX_AGENT_MODE=anonymous npx convex dev --once
rm .env.local
```

Once your cloud deployment exists, plain `npx convex dev` regenerates it. Commit the result whenever the schema or a function signature changes.

## MCP connector

The Convex deployment is also a remote MCP server at `https://<deployment>.convex.site/mcp`. Claude Code can connect today with an API key. claude.ai connectors and Grok need a sign-in and consent page first. The [design note](docs/mcp.md) has the steps.

## Agent skills

`.claude/settings.json` enables three Claude Code plugins for this repo:

- pstack, from its official marketplace (`cursor/plugins`). Start multi-file work with `/pstack:poteto-mode`.
- Matt Pocock's skills (`mattpocock-skills@claude-plugins-official`).
- BeautifulRust (`beautiful-rust@beautiful-rust`) for idiomatic Rust.

`.mcp.json` adds the ExpoKit MCP server, so agents can find and add iPhone components. Claude Code asks you to trust the project marketplaces and MCP server the first time you open the repo. `CLAUDE.md` and `AGENTS.md` hold the house rules.

## From the old LifeOS

The old repo stays read-only. Each capability has a migration issue: the MCP server, the Cloudflare Things mirror, the Mac sync companion, the Oura integration, Apple Calendar and Anytype notes. See the [migration issues](https://github.com/mars-s/lifeos-app/issues?q=label%3Amigration).
