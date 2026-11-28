# Effect migration brief: planner time (the Planner, Work Blocks, Focus, repeats, Smart Blocks)

Issue: #90 on `mars-s/lifeos-app`. Model: Opus 5.5. Repo: `/Users/avi/Developer/projects/lifeos-app`.

You own the half of `planner` that holds when things happen: the Planner, Work Blocks, Focus Sessions, repeating Tasks, Smart Blocks, the timeline, the widgets feed and Smart Estimates. The planner-structure slice owns the rest.

You implement. The patterns are already set: `docs/effect.md` holds the rules and points at reference code that compiles and is tested. Copy those patterns exactly. Where this brief and your habits disagree, the brief wins. Where the brief is silent, `node_modules/effect/AGENTS.md` wins. Avi is asleep: do not ask questions, pick the option closest to the reference code and list the choice in your report.

## Working rules

1. Worktree: `git fetch origin && git worktree add -b effect-planner-time ../lifeos-app-effect-planner-time origin/main`. Write `CONVEX_DEPLOYMENT=dev:curious-pigeon-412` to its `packages/backend/.env.local`, then run `pnpm install`.
2. Before you resume after a dropped connection, make sure no other agent is working in that worktree. One writer per worktree.
3. Read `AGENTS.md`, then `node_modules/effect/AGENTS.md` completely, then `docs/effect.md`, then `docs/effect-migration.md`. Open the reference files `docs/effect.md` lists and copy their patterns.
4. Small green commits straight to main, each ending with `(#90)`. Australian English, no em dashes, no prose comments in code.
5. Before every push: `git fetch origin && git rebase origin/main`, then `LIFEOS_CONVEX_URL=https://curious-pigeon-412.ap-southeast-2.convex.cloud WAKU_PUBLIC_CONVEX_URL=https://curious-pigeon-412.ap-southeast-2.convex.cloud pnpm check`, then `git push origin HEAD:main`. If the push is rejected, rebase and check again. Never force-push.
6. Touch only the files under "Your files". If something outside them must change, say so in your report and leave it.
7. This slice is user-facing, so run the e2e swarm once before your last push: `E2E_WEB_PORT=4302 E2E_CONVEX_PORT=3622 E2E_RELAY_PORT=8803 E2E_WORKERS=3 pnpm e2e`. Those ports are yours, so your run does not collide with another slice. It takes a while and it must be green. `node apps/e2e/src/failures.ts apps/e2e/out/results.json` prints each failure in a line or two. Never run `pnpm e2e:stop` against a stack you did not start.
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

- `packages/backend/convex/planner/focus.ts` (imports neverthrow)
- `packages/backend/convex/planner/plan.ts` (imports neverthrow)
- `packages/backend/convex/planner/recurrence.ts` (imports neverthrow)
- `packages/backend/convex/planner/smartBlocks.ts` (imports neverthrow)
- `packages/backend/convex/planner/smartEstimateModel.ts` (imports neverthrow)
- `packages/backend/convex/planner/smartEstimateTrial.ts`
- `packages/backend/convex/planner/smartEstimates.ts`
- `packages/backend/convex/planner/timeline.ts` (imports neverthrow)
- `packages/backend/convex/planner/widgets.ts` (imports neverthrow)
- `packages/backend/convex/planner/workBlocks.ts` (imports neverthrow)

Tests:

- `packages/backend/convex/planner/focus.test.ts`
- `packages/backend/convex/planner/plan.test.ts`
- `packages/backend/convex/planner/planSeed.test-utils.ts`
- `packages/backend/convex/planner/recurrence.test.ts`
- `packages/backend/convex/planner/smartBlocks.test.ts`
- `packages/backend/convex/planner/smartEstimates.test.ts`
- `packages/backend/convex/planner/timeline.test.ts`
- `packages/backend/convex/planner/widgets.test.ts`
- `packages/backend/convex/planner/workBlocks.test.ts`

## Services this slice needs

`Reads`, `Recorder`, `CurrentActor`, `Acts` (for Smart Estimates) from `convex/platform/effect.ts`, and Effect's `Clock`. Smart Estimates call the AI through `ai/transport.askChoice` and `ai/capabilities` (the ai slice's frozen exports): use `askChoiceFx` once it is on origin/main, the bridge until then.

## What to do

1. Golden wire test first: `convex/planner/timeWire.test.ts`, covering Work Blocks, placing a Task on a day, the week plan, Focus Sessions, repeats and Smart Blocks, with every refusal kind you can reach (`invalid_block`, `invalid_plan`, `invalid_focus`, `invalid_schedule`, `stale_occurrence`, `invalid_smart_block`, `feature_off`, `not_found`).
2. Use the error classes in `convex/planner/errors.ts`. That file belongs to planner-structure: import from it, do not edit it. If a class is missing, declare it in your own file and report it. The Smart Estimate errors (`vSmartEstimateError`, stored in a table) are not in it: if you need classes for them, declare them in a new `convex/planner/smartEstimateErrors.ts` with a `SameWire` test.
3. Convert leaves first: `workBlocks`, `focus`, `recurrence`, `plan`, `timeline`, `widgets`, then `smartEstimates` and its model, then `smartBlocks` (the largest: 505 lines, about 30 Result uses).
4. Read time through `Clock.currentTimeMillis` in what you convert.
5. Convert a function to Effect when it has an expected failure, reads the clock, or uses an external dependency. A pure data helper stays a plain function. A helper that only reads through `ctx` and cannot fail may stay a promise function called through `reading(...)`; convert it when you need to compose it.

## Frozen exports

Returning a neverthrow Result, so they need `Fx` twins: `plan.parseNewPlace`, `plan.placeOnDay`, `workBlocks.parseNewBlock`.

Plain, keep as they are: `focus.endFocusOnClosedTask`, `recurrence.followCompletion`, `recurrence.stopWithLatest`, `smartEstimates.requestSuggestion`, `smartBlocks.loadSnapshot`, `smartBlocks.occurrencesIn`, `smartBlocks.windowOf`, `smartEstimateModel.canonicalJson`, `smartEstimateModel.clock`, `smartEstimateModel.trimNotes`, `workBlocks.vNewBlock`.

Registered functions the ai slice reads in process (never rename): `plan.week`, `recurrence.upcoming`, `workBlocks.range`.

You call into planner-structure (`model.load`, `model.parseTitle`, plus plain helpers in `rows`, `shape`, `today`), calendar (`model.parseTimeZone`, `commitments.parseRange`, both Results; `capacity.capacityDays`, `commitments.commitmentsBetween`, `workingHours.workingHoursOf`, plain), health (`energy.energyDays`), places (`model.roundTripMinutes`, `trips.chosenTrip`) and `shared/recurrence`. Use `Fx` twins and `shared/effect/recurrence` when they exist on origin/main, the bridge when they do not.

## Traps

- Existing tests move time with vitest fake timers. Effect's default `Clock` reads `Date.now()`, so they keep working. Do not rewrite them to `TestClock`; use `TestClock` only in new `it.effect` tests.
- Do not use `Effect.sleep`, `Effect.timeout` or a `Schedule` in a query or a mutation: Convex has no timers there. Smart Estimates run in actions, where they are allowed.
- `vSmartEstimateError` in `planner/tables.ts` is a stored shape. It is not yours to change (and `tables.ts` belongs to planner-structure).
- `smartEstimateModel.ts` imports neverthrow but its exports used by other slices are plain. Check what actually uses the import before you design around it.
- The Planner is perf-tuned on the web. You change no client code, but a slower `plan.week` shows up there: keep the same number of database reads.

## Done when

- `LIFEOS_CONVEX_URL=https://curious-pigeon-412.ap-southeast-2.convex.cloud WAKU_PUBLIC_CONVEX_URL=https://curious-pigeon-412.ap-southeast-2.convex.cloud pnpm check` is green on a commit rebased on origin/main.
- Your golden wire tests are byte-for-byte what your first commit added, and green.
- `git grep -n neverthrow -- <your files>` shows only `*Fx` twins' bridges and `effectFromNeverthrow` calls into other slices.
- `git grep -n "Effect\.run" -- <your files>` shows nothing outside the edges `docs/effect.md` allows.
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
