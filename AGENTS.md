# LifeOS app

A calm personal planner for one person, Avi. Web, iPhone and Mac apps share one hosted Convex backend, and a remote MCP connector exposes the same data to Claude and Grok.

## Writing

- Write in Australian English: colour, organise, behaviour, licence (noun).
- Never use em dashes, in code, comments, docs, commit messages or replies. Use commas, full stops, colons or brackets.

## Code

- TypeScript first, `strict` everywhere. Run `pnpm check` (oxlint, clippy, typecheck, tests, web build) before you call work done.
- Keep it lean. Add a dependency, file or abstraction only when the current task needs it.
- Declare each domain type once, in `packages/backend/convex/schema.ts`. Apps import `Doc`, `Id` and function types from `@lifeos/backend/*`. Never redeclare a table shape in an app.
- Handle expected failures with `neverthrow`. A `Result` that crosses the server/client boundary goes through `serialise` and `deserialise` from `@lifeos/backend/result`, because a class instance does not survive Convex's JSON transport.
- oxlint runs `@interfere/landmines`. It rejects prose comments and annotated return types. Let names carry meaning and put rationale in the commit or PR.
- Use the domain words in `CONTEXT.md` (Task, Area, Project, When, Deadline, Estimate, Work Block, and so on). Its Authority section says which system owns which field.
- The product spec is GitHub issue #15. Design references and what to take from each are in `docs/design/references/`. Check UI work against them.

## Experience bar

Avi will not use an app that feels below Things 3, the Claude app or the Grok app. Every interaction answers within a frame, can be undone, and never waits on the network. Numbers and time are drawn as tactile, analog visualisations in the TuffUI style. Load the design skills (impeccable, emil-design-eng, apple-design, animate, animate-expo, unslop-ui) before building UI, and verify each screen on the real surface in light and dark.

## Best-practice sources

Follow these before your own habits, and read them before writing code in that area.

- **Expo (`apps/mobile`):** [ExpoKit](https://expokit.in) is the UI kit and the reference for iPhone patterns. Add components with `npx @expokit/cli@latest add <name>` (or the `expokit` MCP server in `.mcp.json`). They land in `apps/mobile/src/components/ui` and read the calm theme from `apps/mobile/src/lib/kit-theme.tsx`. Free items only, unless Avi has logged in to a Pro plan.
- **Rust (`apps/desktop/src-tauri`):** [BeautifulRust](https://github.com/morganlinton/BeautifulRust). Its `rust-best-practices` skill is enabled for this repo and its clippy config is in `Cargo.toml` and `clippy.toml`. `pnpm --filter @lifeos/desktop lint` must pass with zero warnings.
- **Convex (`packages/backend`):** read `packages/backend/convex/_generated/ai/guidelines.md` first. Convex's own agent skills live in `packages/backend/.claude/skills`.
- **TuffUI (`apps/web`):** https://tuffui.com/llms.txt. Install components with `pnpm dlx shadcn@latest add https://tuffui.com/r/<name>.json` from `apps/web`.
- **Waku (`apps/web`):** the official docs for agents at https://waku.gg/llms.txt (full text at https://waku.gg/llms-full.txt).
- **Errors:** `neverthrow` only. Do not add Effect alongside it. One error model is enough until a real need for Effect's runtime (fibres, scheduling, dependency injection) shows up.

## Convex

- Backend code lives in `packages/backend/convex`. Commit `convex/_generated` after any schema or function change.
- Do not run commands that need a browser sign-in on Avi's behalf. For codegen without an account, use `CONVEX_AGENT_MODE=anonymous npx convex dev --once`, then delete `packages/backend/.env.local`.

## Tracking

- Track work in GitHub issues on `mars-s/lifeos-app`. Reference the issue in each commit or PR.
- The old LifeOS repo (`mars-s/lifeos`, local checkout `~/Developer/projects/lifeos`) is read-only reference material. Never edit it.
