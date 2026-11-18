# LifeOS app

A calm personal planner for one person, Avi. Web, iPhone and Mac apps share one hosted Convex backend, and a remote MCP connector exposes the same data to Claude and Grok.

## Writing

- Write in Australian English: colour, organise, behaviour, licence (noun).
- Never use em dashes, in code, comments, docs, commit messages or replies. Use commas, full stops, colons or brackets.

## Code

- TypeScript first, `strict` everywhere. Run `pnpm check` (oxlint, clippy, typecheck, tests, web build) before you call work done.
- Keep it lean. Add a dependency, file or abstraction only when the current task needs it.
- Declare each domain type once, in the Convex schema. `packages/backend/convex/schema.ts` composes one `tables.ts` per module. Apps import `Doc`, `Id` and function types from `@lifeos/backend/*`. Never redeclare a table shape in an app. `docs/data-model.md` lists every table, its indexes and the queries they serve.
- Module code lives in `packages/backend/convex/<module>/`: `platform` (Activity, undo, Jobs, Workers, entity links) and `planner` (Tasks, Areas, Projects, Checklist Items, Work Blocks, Today, the Things Bridge). A new module adds a folder with its own `tables.ts`.
- Every public Convex function goes through the owner guard in `convex/platform/access.ts`: `ownerQuery` for queries, `changeMutation` (built on `ownerMutation`) for changes, `workerMutation` for Worker endpoints. Only Avi, signed in with GitHub, or a Worker with its token can call them. oxlint rejects the raw `query`, `mutation` and `action` builders anywhere else. See `docs/auth.md`.
- Build every public mutation with `changeMutation` from `convex/platform/change.ts` and write through its recorder, so each change records Activity, can be undone, and queues a Things Operation when it touches a Things-owned field.
- Backend tests use convex-test and vitest (`pnpm --filter @lifeos/backend test`). Put each `*.test.ts` beside the module it tests and call public functions through `api`. Convex skips files with more than one dot, so test files and `*.test-utils.ts` helpers are never deployed.
- Handle expected failures with `neverthrow`. A `Result` that crosses the server/client boundary goes through `serialise` and `deserialise` from `@lifeos/backend/result`, because a class instance does not survive Convex's JSON transport.
- oxlint runs `@interfere/landmines`. It rejects prose comments and annotated return types. Let names carry meaning and put rationale in the commit or PR.
- Use the domain words in `CONTEXT.md` (Task, Area, Project, When, Deadline, Estimate, Work Block, and so on). Its Authority section says which system owns which field.
- `docs/architecture.md` fixes how Core, the Home Server, Workers, Jobs and modules fit together. Build every new feature as part of a module that uses the shared primitives.
- The product spec is GitHub issue #15. Design references and what to take from each are in `docs/design/references/`. Check UI work against them.

## Experience bar

Avi will not use an app that feels below Things 3, the Claude app or the Grok app. Every interaction answers within a frame, can be undone, and never waits on the network. Numbers and time are drawn as tactile, analog visualisations in the TuffUI style. Load the design skills (impeccable, emil-design-eng, apple-design, animate, animate-expo, unslop-ui) before building UI, and verify each screen on the real surface in light and dark.

## Best-practice sources

Follow these before your own habits, and read them before writing code in that area.

- **Expo (`apps/mobile`):** [ExpoKit](https://expokit.in) is the UI kit and the reference for iPhone patterns. Add components with `npx @expokit/cli@latest add <name>` (or the `expokit` MCP server in `.mcp.json`). They land in `apps/mobile/src/components/ui` and read the calm theme from `apps/mobile/src/lib/kit-theme.tsx`. Free items only, unless Avi has logged in to a Pro plan.
- **Rust (`apps/desktop/src-tauri`):** [BeautifulRust](https://github.com/morganlinton/BeautifulRust). Load `rust-best-practices` before writing Rust and run `rust-review` over any Rust diff. Its clippy config is in `Cargo.toml` and `clippy.toml`. `pnpm --filter @lifeos/desktop lint` must pass with zero warnings.
- **Convex (`packages/backend`):** read `packages/backend/convex/_generated/ai/guidelines.md` first. Convex's own agent skills live in `packages/backend/.claude/skills`.
- **TuffUI (`apps/web`):** https://tuffui.com/llms.txt. Install components with `pnpm dlx shadcn@latest add https://tuffui.com/r/<name>.json` from `apps/web`.
- **Waku (`apps/web`):** the official docs for agents at https://waku.gg/llms.txt (full text at https://waku.gg/llms-full.txt).
- **UI code (web and Mac):** load `vercel-react-best-practices` and `vercel-composition-patterns` while building, `vercel-react-view-transitions` for route and list transitions, and run `web-design-guidelines` over every changed UI file before calling a slice done. Fix what it finds.
- **iPhone code:** load `vercel-react-native-skills` alongside ExpoKit.
- **Browser checks:** `webapp-testing` (Playwright) for repeatable UI checks; save useful scripts so the next agent can rerun them.
- **MCP server:** load `mcp-builder` before changing `packages/backend/convex/mcp.ts`.
- **Errors:** `neverthrow` only. Do not add Effect alongside it. One error model is enough until a real need for Effect's runtime (fibres, scheduling, dependency injection) shows up.

## Convex

- Deploy to the dev deployment (`npx convex dev --once`) only from a commit that already contains everything on origin/main, and push that commit right after. Deploying an unpushed or stale branch removes functions the live web app needs, and leaves data the main schema rejects.
- Backend code lives in `packages/backend/convex`. Commit `convex/_generated` after any schema or function change.
- Do not run commands that need a browser sign-in on Avi's behalf. In a worktree, write `CONVEX_DEPLOYMENT=dev:curious-pigeon-412` to `packages/backend/.env.local`; the logged-in CLI then deploys with `npx convex dev --once`. Never delete `packages/backend/.env.local` in the main checkout: it links Avi's `npx convex dev` to his deployment. For a throwaway local backend (seed data, experiments), run `CONVEX_AGENT_MODE=anonymous npx convex dev` in a scratch copy, never in a checkout that has the real link.

## Tracking

- Track work in GitHub issues on `mars-s/lifeos-app`. Reference the issue in each commit or PR.
- The old LifeOS repo (`mars-s/lifeos`, local checkout `~/Developer/projects/lifeos`) is read-only reference material. Never edit it.
