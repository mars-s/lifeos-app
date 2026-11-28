# Effect migration brief: ai, the MCP connector and the agent tools

Issue: #90 on `mars-s/lifeos-app`. Model: Opus 5.5. Repo: `/Users/avi/Developer/projects/lifeos-app`.

You own the AI engine, the remote MCP connector and the agent tools that read and change the planner on Avi's behalf.

You implement. The patterns are already set: `docs/effect.md` holds the rules and points at reference code that compiles and is tested. Copy those patterns exactly. Where this brief and your habits disagree, the brief wins. Where the brief is silent, `node_modules/effect/AGENTS.md` wins. Avi is asleep: do not ask questions, pick the option closest to the reference code and list the choice in your report.

## Working rules

1. Worktree: `git fetch origin && git worktree add -b effect-ai ../lifeos-app-effect-ai origin/main`. Write `CONVEX_DEPLOYMENT=dev:curious-pigeon-412` to its `packages/backend/.env.local`, then run `pnpm install`.
2. Before you resume after a dropped connection, make sure no other agent is working in that worktree. One writer per worktree.
3. Read `AGENTS.md`, then `node_modules/effect/AGENTS.md` completely, then `docs/effect.md`, then `docs/effect-migration.md`. Open the reference files `docs/effect.md` lists and copy their patterns.
4. Small green commits straight to main, each ending with `(#90)`. Australian English, no em dashes, no prose comments in code.
5. Before every push: `git fetch origin && git rebase origin/main`, then `LIFEOS_CONVEX_URL=https://curious-pigeon-412.ap-southeast-2.convex.cloud WAKU_PUBLIC_CONVEX_URL=https://curious-pigeon-412.ap-southeast-2.convex.cloud pnpm check`, then `git push origin HEAD:main`. If the push is rejected, rebase and check again. Never force-push.
6. Touch only the files under "Your files". If something outside them must change, say so in your report and leave it.
7. This slice is user-facing, so run the e2e swarm once before your last push: `E2E_WEB_PORT=4304 E2E_CONVEX_PORT=3624 E2E_RELAY_PORT=8805 E2E_WORKERS=3 pnpm e2e`. Those ports are yours, so your run does not collide with another slice. It takes a while and it must be green. `node apps/e2e/src/failures.ts apps/e2e/out/results.json` prints each failure in a line or two. Never run `pnpm e2e:stop` against a stack you did not start.
8. Do not deploy Convex. One deployer (the orchestrator) deploys origin/main after slices land, so two slices never race on the dev deployment. If you are told to deploy: only from a commit that contains all of origin/main, with `pnpm check` green and the wire tests untouched, with `npx convex dev --once` from `packages/backend`, and push that commit right after. A deploy must keep the installed iPhone and Mac apps working.
9. If you commit `convex/_generated` changes, generate them in a scratch copy, never against the real link (`AGENTS.md`, Convex section).

## Hard rules

- Put `export PATH=/run/current-system/sw/bin:$PATH` first in shell commands. Work in a git worktree off origin/main, with `CONVEX_DEPLOYMENT=dev:curious-pigeon-412` in its packages/backend/.env.local.
- Never read credential files. Never print tokens. Never delete packages/backend/.env.local in the main checkout. Never write to Things or run `pnpm things:switch`. Never put Avi's email in the repo. Never run anything that needs a browser sign-in. Don't kill processes you didn't start. Keep CPU use moderate.
- Subagents only Sonnet 5.5 or Haiku 5.5. Be token efficient.

## The wire contract (the constraint that outranks everything else)

Avi's iPhone and Mac apps are installed builds that talk to the live dev backend, and the backend is deployed while this migration runs. So until the final slice says otherwise:

- Never change an `args` or `returns` validator, a stored validator in a `tables.ts`, a file path under `convex/`, or the name of an exported Convex function. The path and the name are the API.
- Never change the JSON a public function returns. A refusal is `{ ok: false, error: { kind, ...fields } }` and a success is `{ ok: true, value }`, with the same kinds, field names and types as today. `_tag` never crosses the wire.
- Your first commit, before you change any code, adds a golden wire test for each backend module you own (the steps below name the file; a client-only slice has none). It calls public functions through `api` and asserts the whole returned JSON with `toStrictEqual`: one success and every refusal kind you can reach, per function family. It must pass on the code as it is. After that commit you never edit it. If it fails later, your change is wrong, not the test.
- Each `errors.ts` you write has a type test `SameWire<NewFailureUnion, OldErrorUnion>` (see `packages/backend/convex/planner/errors.test.ts`). Keep the old plain union type exported until the final slice: other slices and the apps import it.
- Do not weaken an existing assertion on a returned value. Existing tests call the public API, so they are the contract too.
- The web, iPhone and things-sync typechecks in `pnpm check` read the backend's inferred types. If one of them fails after a backend change, you changed a wire type: fix the backend, not the client.

## Working beside the other slices

Seven slices run at once on disjoint files. Code in one slice calls code in another, and they will not land in a known order. So:

- **Frozen exports.** A function that another slice imports keeps its name and its exact signature until the final slice. Your frozen exports are listed below.
- **Twins.** When a frozen export returns a neverthrow `Result` or `ResultAsync`, write the real logic as an Effect in the same file under the same name plus `Fx` (`placeOnDay` and `placeOnDayFx`). The old name becomes a one-line bridge over the twin: `legacyRead(ctx, twinFx(...))` or `legacyChange(ctx, record, twinFx(...))` from `convex/platform/effect.ts`, or `toNeverthrow(...)` from `shared/effect/bridge.ts` for pure code. Inside your slice, call the twin.
- **Calling another slice.** If `<name>Fx` exists on origin/main, call it. If not, call the old function through `effectFromNeverthrow(() => old(...))` from `shared/effect/bridge.ts`. Plain `{ kind }` errors from old code pass through the wire encoder unchanged.
- **Registered functions are never twinned.** `export const create = changeMutation(...)` keeps its name. Agent tools reach it through `changeAs` and `readAsOwner`, which accept functions from either builder.
- Only `*Fx` twins and bridge calls may mention neverthrow in your files when you finish. The final slice deletes the old names, renames each `*Fx` to the plain name and removes the bridges.

## Your files

Source:

- `packages/backend/convex/ai/adapter.ts`
- `packages/backend/convex/ai/agent.ts`
- `packages/backend/convex/ai/aiIndex.ts`
- `packages/backend/convex/ai/capabilities.ts`
- `packages/backend/convex/ai/embeddings.ts` (imports neverthrow)
- `packages/backend/convex/ai/indexRows.ts`
- `packages/backend/convex/ai/memory.ts` (imports neverthrow)
- `packages/backend/convex/ai/migrations.ts`
- `packages/backend/convex/ai/models.ts`
- `packages/backend/convex/ai/policy.ts`
- `packages/backend/convex/ai/proposals.ts`
- `packages/backend/convex/ai/routing.ts` (imports neverthrow)
- `packages/backend/convex/ai/runs.ts` (imports neverthrow)
- `packages/backend/convex/ai/search.ts`
- `packages/backend/convex/ai/steps.ts` (imports neverthrow)
- `packages/backend/convex/ai/tables.ts`
- `packages/backend/convex/ai/transport.ts` (imports neverthrow)
- `packages/backend/convex/mcp.ts`
- `packages/backend/convex/planner/agentReads.ts`
- `packages/backend/convex/planner/agentSmartBlocks.ts`
- `packages/backend/convex/planner/agentWrites.ts`
- `packages/backend/convex/tools.ts`

Tests:

- `packages/backend/convex/ai/ai.test.ts`
- `packages/backend/convex/ai/aiIndex.test.ts`
- `packages/backend/convex/ai/runs.test.ts`
- `packages/backend/convex/mcp.test.ts`
- `packages/backend/convex/planner/agentSmartBlocks.test.ts`

## Services this slice needs

You build: `AiRouter` (which Provider and model answer a Capability, from `ai/routing.ts`) and `AiProvider` (one call to a provider), each with a live Layer on the AI SDK and a test Layer with a scripted model. From the foundation: `Secrets`, `Reads`, `Writes`, `Acts`, `CurrentActor`, `runChange`, `changeAsFx`, `readAsOwnerFx`.

## What to do

1. Load the `mcp-builder` skill before you touch `convex/mcp.ts`.
2. Golden wire tests first: `convex/ai/wire.test.ts` for the public functions. `convex/mcp.test.ts` already pins the MCP tools; treat it as a golden file and do not edit its assertions.
3. Error classes in `convex/ai/errors.ts` with a `SameWire` test against `AiError` (an `Infer` type of the stored `vAiError`).
4. Convert `routing.ts`, `embeddings.ts`, `transport.ts`, `memory.ts`, `steps.ts`, `runs.ts`.
5. Move the agent tools (`planner/agentReads.ts`, `planner/agentWrites.ts`, `planner/agentSmartBlocks.ts`, `convex/tools.ts`) from `changeAs` and `readAsOwner` to `changeAsFx` and `readAsOwnerFx`.
6. Decode provider responses with Schema at the `AiProvider` boundary.
7. Convert a function to Effect when it has an expected failure, reads the clock, or uses an external dependency. A pure data helper stays a plain function. A helper that only reads through `ctx` and cannot fail may stay a promise function called through `reading(...)`; convert it when you need to compose it.

## Frozen exports

Returning a neverthrow ResultAsync or Result, so it needs an `Fx` twin: `ai/transport.askChoice`.

Plain, keep as they are: `ai/capabilities.attemptsFor`, `capabilityChain`, `capabilityReady`, `ai/indexRows.indexChanged` (the recorder calls it), `convex/mcp.mcp`.

You read registered functions of both planner slices and notes in process; they keep their names.

## Traps

- The MCP tool names, input schemas and result JSON are a wire too: Claude and Grok connectors call them. They must not change.
- Keep the AI SDK and `@convex-dev/agent`. Wrap them in services; do not swap to `effect/ai` in this slice.
- Test the agent with MSW, not `vi.mock`. convex-test has a cross-component id bug: keep the workarounds the existing tests use.
- There is an import cycle risk between the recorder and `ai/indexRows.ts`. `indexRows.ts` must not import `platform/effect.ts`.
- Streaming callbacks from the AI SDK run outside any fibre. Keep Effect out of them, or run a small Effect through the action builder's runtime; never call `Effect.runPromise` there yourself.
- `vAiError` is stored in tables. Never change it; build stored values with `wireError(...)`.
- AI is embedded in the product, not a chat sidebar. You change no behaviour here.
- OpenCode Go needs the `x-opencode-session` header and the Decisions API answers are peaked: keep the request shapes byte for byte.

## Done when

- `LIFEOS_CONVEX_URL=https://curious-pigeon-412.ap-southeast-2.convex.cloud WAKU_PUBLIC_CONVEX_URL=https://curious-pigeon-412.ap-southeast-2.convex.cloud pnpm check` is green on a commit rebased on origin/main.
- Your golden wire tests are byte-for-byte what your first commit added, and green.
- `git grep -n neverthrow -- <your files>` shows only `*Fx` twins' bridges and `effectFromNeverthrow` calls into other slices.
- `git grep -n "Effect\.run" -- <your files>` shows nothing outside the edges `docs/effect.md` allows.
- `convex/mcp.test.ts` assertions are untouched and green.
- `pnpm e2e` is green.

## Report (short, plain words)

- Slice name, and your commits on main.
- What moved to Effect: files, services and Layers added (with their test Layers), error classes.
- Twins and bridges left for the final slice, by name.
- Wire: the golden test files, the `SameWire` tests, and anything that looked like a wire risk.
- Checks: `pnpm check`, `pnpm e2e` if this slice runs it, and anything else you ran, with results.
- Anything you left undone or changed outside your files, and why.
- Risks the final slice or Avi should know about.

Post the same report as a comment on issue #90 (`gh issue comment`), so the final slice can read it.
