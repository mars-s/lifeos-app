# Effect migration brief: planner structure (Tasks, Areas, Projects, lists)

Issue: #90 on `mars-s/lifeos-app`. Model: Opus 5.5. Repo: `/Users/avi/Developer/projects/lifeos-app`.

You own the half of `planner` that holds what things are: Tasks, Areas, Projects, labels, Checklist Items, templates, the lists and the trash. The planner-time slice owns when they happen.

You implement. The patterns are already set: `docs/effect.md` holds the rules and points at reference code that compiles and is tested. Copy those patterns exactly. Where this brief and your habits disagree, the brief wins. Where the brief is silent, `node_modules/effect/AGENTS.md` wins. Avi is asleep: do not ask questions, pick the option closest to the reference code and list the choice in your report.

## Working rules

1. Worktree: `git fetch origin && git worktree add -b effect-planner-structure ../lifeos-app-effect-planner-structure origin/main`. Write `CONVEX_DEPLOYMENT=dev:curious-pigeon-412` to its `packages/backend/.env.local`, then run `pnpm install`.
2. Before you resume after a dropped connection, make sure no other agent is working in that worktree. One writer per worktree.
3. Read `AGENTS.md`, then `node_modules/effect/AGENTS.md` completely, then `docs/effect.md`, then `docs/effect-migration.md`. Open the reference files `docs/effect.md` lists and copy their patterns.
4. Small green commits straight to main, each ending with `(#90)`. Australian English, no em dashes, no prose comments in code.
5. Before every push: `git fetch origin && git rebase origin/main`, then `LIFEOS_CONVEX_URL=https://curious-pigeon-412.ap-southeast-2.convex.cloud WAKU_PUBLIC_CONVEX_URL=https://curious-pigeon-412.ap-southeast-2.convex.cloud pnpm check`, then `git push origin HEAD:main`. If the push is rejected, rebase and check again. Never force-push.
6. Touch only the files under "Your files". If something outside them must change, say so in your report and leave it.
7. This slice is user-facing, so run the e2e swarm once before your last push: `E2E_WEB_PORT=4301 E2E_CONVEX_PORT=3621 E2E_RELAY_PORT=8802 E2E_WORKERS=3 pnpm e2e`. Those ports are yours, so your run does not collide with another slice. It takes a while and it must be green. `node apps/e2e/src/failures.ts apps/e2e/out/results.json` prints each failure in a line or two. Never run `pnpm e2e:stop` against a stack you did not start.
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

- `packages/backend/convex/planner/areas.ts` (imports neverthrow)
- `packages/backend/convex/planner/checklist.ts` (imports neverthrow)
- `packages/backend/convex/planner/containers.ts`
- `packages/backend/convex/planner/convert.ts` (imports neverthrow)
- `packages/backend/convex/planner/labels.ts` (imports neverthrow)
- `packages/backend/convex/planner/lists.ts`
- `packages/backend/convex/planner/model.ts` (imports neverthrow)
- `packages/backend/convex/planner/projects.ts` (imports neverthrow)
- `packages/backend/convex/planner/rollups.ts`
- `packages/backend/convex/planner/rows.ts`
- `packages/backend/convex/planner/selection.ts` (imports neverthrow)
- `packages/backend/convex/planner/shape.ts`
- `packages/backend/convex/planner/sidebar.ts`
- `packages/backend/convex/planner/tables.ts`
- `packages/backend/convex/planner/tasks.ts` (imports neverthrow)
- `packages/backend/convex/planner/templates.ts` (imports neverthrow)
- `packages/backend/convex/planner/today.ts`
- `packages/backend/convex/planner/trash.ts` (imports neverthrow)

Tests:

- `packages/backend/convex/planner/checklist.test.ts`
- `packages/backend/convex/planner/containers.test.ts`
- `packages/backend/convex/planner/convert.test.ts`
- `packages/backend/convex/planner/labels.test.ts`
- `packages/backend/convex/planner/lists.test.ts`
- `packages/backend/convex/planner/rollups.test.ts`
- `packages/backend/convex/planner/seed.test-utils.ts`
- `packages/backend/convex/planner/selection.test.ts`
- `packages/backend/convex/planner/tasks.test.ts`
- `packages/backend/convex/planner/templates.test.ts`
- `packages/backend/convex/planner/today.test.ts`
- `packages/backend/convex/planner/trash.test.ts`

## Services this slice needs

`Reads`, `Recorder` and `CurrentActor` from `convex/platform/effect.ts`. No new service. Feature switches come from `platform/features.ts` (frozen exports).

## What to do

1. Golden wire test first: `convex/planner/structureWire.test.ts`, covering create, rename, move, complete, trash and restore for Tasks, Areas, Projects, labels, Checklist Items and templates, with every refusal kind you can reach (`not_found`, `empty_title`, `invalid_date`, `invalid_estimate`, `invalid_order`, `name_taken`, `not_trashed`, `invalid_icon`, `selection_too_large`, `heading_outside_project`, `invalid_template`, `feature_off`).
2. `convex/planner/errors.ts` already holds every planner error class and its `SameWire` test. You own it. Use the classes; add none unless a new kind is truly needed (it should not be).
3. Convert `model.ts` first: the parsers become pure functions returning Effect's `Result`, and `load` becomes an Effect. Keep `PlannerError` exported.
4. Convert the rest, leaves first: `labels`, `checklist`, `areas`, `projects`, `templates`, `convert`, `selection`, `trash`, `tasks`, then the queries (`lists`, `today`, `sidebar`). A query that returns a Result wraps its program in `asWire`.
5. Convert a function to Effect when it has an expected failure, reads the clock, or uses an external dependency. A pure data helper stays a plain function. A helper that only reads through `ctx` and cannot fail may stay a promise function called through `reading(...)`; convert it when you need to compose it.

## Frozen exports

Returning a neverthrow Result, so they need `Fx` twins: `model.load`, `model.parseTitle`.

Plain, keep as they are: `labels.labelNamed`, `model.keyAfter`, `model.lastTaskOrder`, `model.liveHome`, `rows.compare`, `rows.enrich`, `rows.isLive`, `rows.loadContainers`, `shape.createFromShape`, `shape.homeSummary`, `shape.scheduledDate`, `shape.snapshotTask`, `today.byTodayOrder`, `today.openTodayTasks`, `rollups.noteWrite`, `rollups.nothingTouched`, `rollups.settle` (the recorder in `platform/activity.ts` calls these three).

Registered functions the ai slice reads in process (never rename): `labels.list`, `lists.anytime`, `lists.inbox`, `lists.logbook`, `lists.someday`, `lists.upcoming`, `templates.list`, `today.get`.

You call into planner-time (`focus.endFocusOnClosedTask`, `recurrence.followCompletion`, `recurrence.stopWithLatest`, `plan.placeOnDay`, `plan.parseNewPlace`, `workBlocks.parseNewBlock`, `smartEstimates.requestSuggestion`) and into places (`trips.requestTrip`). Use their `Fx` twins when they exist on origin/main, the bridge when they do not.

## Traps

- `tasks.create` uses neverthrow's `Result.combine([...])`, which reports the first failure in array order. Keep that order when you move to `Effect.all` or `Result.all`, so the same input still gets the same refusal.
- `NameTaken` has a `taken` field and a `wire()` method, because `Error` owns `name`. The wire still says `name`.
- `FeatureOff` covers both `templates` and `smartBlocks`.
- A change that refuses after it wrote throws. Parse and load before the first `recording(...)` call, as the code does today.
- `edit` in `tasks.ts` takes a callback that may return a Result or a promise of one. Make the callback return an Effect.
- `rollups.ts` is called by the recorder on every write. Do not add Effect to it.
- Tasks live in Convex: never treat a field as owned by Things.

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
