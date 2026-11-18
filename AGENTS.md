# LifeOS app

A calm personal planner for one person, Avi. Web, iPhone and Mac apps share one hosted Convex backend, and a remote MCP connector exposes the same data to Claude and Grok.

## Writing

- Write in Australian English: colour, organise, behaviour, licence (noun).
- Never use em dashes, in code, comments, docs, commit messages or replies. Use commas, full stops, colons or brackets.

## Code

- TypeScript first, `strict` everywhere. Run `pnpm check` (lint, typecheck, web build) before you call work done.
- Keep it lean. Add a dependency, file or abstraction only when the current task needs it.
- Declare each domain type once, in `packages/backend/convex/schema.ts`. Apps import `Doc`, `Id` and function types from `@lifeos/backend/*`. Never redeclare a table shape in an app.
- Handle expected failures with `neverthrow`. A `Result` that crosses the server/client boundary goes through `serialise` and `deserialise` from `@lifeos/backend/result`, because a class instance does not survive Convex's JSON transport.
- oxlint runs `@interfere/landmines`. It rejects prose comments and annotated return types. Let names carry meaning and put rationale in the commit or PR.
- Things 3 is the canonical task store and Apple Calendar is the calendar source. Convex mirrors them. Do not build a second source of truth.

## Convex

- Backend code lives in `packages/backend/convex`. Commit `convex/_generated` after any schema or function change.
- Do not run commands that need a browser sign-in on Avi's behalf. For codegen without an account, use `CONVEX_AGENT_MODE=anonymous npx convex dev --once`, then delete `packages/backend/.env.local`.

## Tracking

- Track work in GitHub issues on `mars-s/lifeos-app`. Reference the issue in each commit or PR.
- The old LifeOS repo (`mars-s/lifeos`, local checkout `~/Developer/projects/lifeos`) is read-only reference material. Never edit it.
