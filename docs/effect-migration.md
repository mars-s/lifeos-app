# Effect migration plan

Issue #90. Decided by Avi on 28 Nov 2026: move the whole app to the latest Effect, remove neverthrow, and use Effect's dependency injection, Schema and Atom. One planner set the patterns (`docs/effect.md`); Opus and Sonnet agents implement the slices below from the briefs in `docs/effect-briefs/`.

Status: the tooling, the rules, the reference code and the briefs are on main. No slice has started.

## What is already on main

- `effect` 4.1.7 in the backend, web, iPhone and things-sync packages and at the root; `@effect/vitest` in the backend and web; `@effect/atom-react` in web and iPhone; `@effect/language-service` as a TypeScript plugin.
- The official `effect-ts` skill in `.claude/skills/effect-ts`.
- `docs/effect.md`: the rules, and the choices made where Avi could not be asked.
- Reference code with tests: the Result transport (`shared/effect/wire.ts`), shared and planner tagged errors, an Effect `ownerQuery` and `changeMutation` sketch, a service with live and test Layers and a Schema boundary, atoms with a client `Backend` service, and atom components for React and React Native.
- Checked on a real local Convex backend: Effect 4.1.7 bundles and runs in queries and mutations, and Convex refuses `setTimeout` there, which is why the builders run on a synchronous scheduler.

## The constraint

Avi's iPhone and Mac apps are installed builds on the live dev backend (`curious-pigeon-412`), and Convex is deployed while the migration runs. Every public function's argument and return shapes, and the JSON of every Result, stay exactly compatible throughout.

How that is kept:

1. **The wire format does not change, during the migration or after it.** A Result crosses as `{ ok: true, value }` or `{ ok: false, error: { kind, ...fields } }`, which is what neverthrow's `serialise` produced. Effect's `_tag` is internal and is stripped by `wireError`. So there is never a second format for an installed app to meet, and no flag day at the end.
2. **Wire-format tests.**
   - `shared/effect/wire.test.ts` proves the Effect encoder matches `serialise` byte for byte and that the neverthrow `deserialise` an installed app runs still reads it.
   - Each backend slice's first commit adds a golden wire test per module: public functions called through `api`, the whole returned JSON asserted with `toStrictEqual`, passing on the unmigrated code. It is never edited afterwards.
   - Each `errors.ts` has a `SameWire` type test against the old plain error union, so a changed kind or field fails typecheck.
   - The existing tests call the public API and stay untouched where they assert returned values.
   - The web, iPhone and things-sync typechecks read the backend's inferred types, so a changed wire type fails `pnpm check` in a package the backend slice may not edit.
3. **A decoder that reads both shapes.** On the client, `wireToResult` and `wireToEffect` read a clean refusal and also one that leaked a `_tag`, and give the same value for both. On the server, the encoder passes a plain `{ kind }` error from unmigrated code through unchanged, so mixed old and new code produce one format.
4. **Names are the API.** No `args` or `returns` validator, stored validator, file path under `convex/` or exported function name changes.
5. **Order of deploys.** See below.

## Order

```text
0. foundation            alone, first
1. planner-structure  ┐
2. planner-time       │
3. calendar-health-   │
   places             │  in parallel, after the foundation lands
4. ai                 │
5. notes              │
6. web                │
7. mobile-things      ┘
8. final                 alone, last
```

| Slice | Brief | Model | Files (source, tests) | Import neverthrow | Runs `pnpm e2e` |
| --- | --- | --- | --- | --- | --- |
| foundation | `docs/effect-briefs/foundation.md` | Opus 5.5 | 31, 16 | 12 | yes |
| planner-structure | `docs/effect-briefs/planner-structure.md` | Opus 5.5 | 18, 12 | 10 | yes |
| planner-time | `docs/effect-briefs/planner-time.md` | Opus 5.5 | 10, 9 | 8 | yes |
| calendar-health-places | `docs/effect-briefs/calendar-health-places.md` | Sonnet 5.5 | 16, 6 | 12 | yes |
| ai | `docs/effect-briefs/ai.md` | Opus 5.5 | 22, 5 | 6 | yes |
| notes | `docs/effect-briefs/notes.md` | Sonnet 5.5 | 25, 6 | 1 | yes |
| web | `docs/effect-briefs/web.md` | Opus 5.5 | 297, 11 (25 stores) | 4 | yes, and `e2e:perf` |
| mobile-things | `docs/effect-briefs/mobile-things.md` | Sonnet 5.5 | 102, 5 (8 stores) | 8 | no |
| final | `docs/effect-briefs/final.md` | Opus 5.5 | whole repo | 0 left | yes, and `e2e:perf` |

The 61 files that import neverthrow are all assigned. Counts are tracked `.ts` and `.tsx` files without generated code.

What each slice owns:

- **foundation:** `convex/platform/`, the top-level `convex/*.ts` files (`http.ts`, `auth.ts`, `crons.ts`, the test utils), `shared/*.ts`, `shared/effect/`, and the new `shared/client/backend.ts`. Services: `Reads`, `Writes`, `Acts`, `Recorder`, `CurrentActor`, `CurrentWorker`, `Secrets`, `Backend`.
- **planner-structure:** in `convex/planner/`: `model`, `errors`, `tables`, `tasks`, `areas`, `projects`, `labels`, `checklist`, `templates`, `convert`, `selection`, `trash`, `containers`, `lists`, `today`, `sidebar`, `rows`, `shape`, `rollups`. Services: none new.
- **planner-time:** in `convex/planner/`: `plan`, `workBlocks`, `focus`, `recurrence`, `smartBlocks`, `timeline`, `widgets`, `smartEstimates`, `smartEstimateModel`, `smartEstimateTrial`. Services: `Clock`.
- **calendar-health-places:** `convex/calendar/`, `convex/health/`, `convex/places/`. Services: `Oura`, `OuraToken`, `Places`.
- **ai:** `convex/ai/`, `convex/mcp.ts`, `convex/tools.ts`, `convex/planner/agent*.ts`. Services: `AiRouter`, `AiProvider`.
- **notes:** `convex/notes/`, `packages/notes/`, `apps/relay/`. Services: `RelayToken`.
- **web:** `apps/web/`, the TypeScript in `apps/desktop/`, `shared/client/` (except `backend.ts`). Services: `Backend`, `KeyValueStore`.
- **mobile-things:** `apps/mobile/`, `apps/things-sync/`, `packages/widget-kit/`, `convex/planner/things*.ts`. Services: `ThingsSource`, `Backend`, `KeyValueStore`.
- **final:** everything, once the rest has landed.

`apps/e2e/` belongs to no slice. If a spec has to change, the migration changed behaviour: fix the code.

## How parallel slices meet

Slices call each other's code and land in no fixed order. The protocol is in every brief:

- A function another slice imports keeps its name and signature (a frozen export) until the final slice.
- A frozen export that returns a neverthrow Result gets an Effect twin with the suffix `Fx` in the same file; the old name becomes a one-line bridge over the twin.
- A slice calls another slice's `Fx` twin if it is on origin/main, and the old function through `effectFromNeverthrow` if it is not.
- Registered Convex functions are never twinned or renamed.

Only eight functions outside the foundation need twins: `ai/transport.askChoice`, `calendar/commitments.parseRange`, `calendar/model.parseTimeZone`, `planner/model.load`, `planner/model.parseTitle`, `planner/plan.parseNewPlace`, `planner/plan.placeOnDay`, `planner/workBlocks.parseNewBlock`, and in the foundation `platform/change.changeAs` plus the shared parsers (`parseIsoDate`, `parseEstimateText`, `parseSchedule`, `parseEnd`, `parseTimeZone`), which move through `shared/effect/` instead of a suffix.

The final slice deletes the old names, renames each twin, folds `shared/effect/` back into `shared/`, deletes the bridges and the pattern files, removes the dependency and bans it in oxlint.

## Deploys

One deployer at a time. Parallel slices do not deploy; the orchestrator does, so two slices never race on the one dev deployment.

1. This tooling commit: no deploy.
2. After the foundation lands: deploy, so the builders meet the real runtime while the blast radius is small.
3. After each parallel slice lands (or after a batch): deploy origin/main.
4. The final slice deploys its last commit.

Each deploy:

1. `git fetch origin`, and check out exactly origin/main. Never deploy an unpushed or stale commit: it removes functions the live web app needs.
2. `pnpm check` is green, with `LIFEOS_CONVEX_URL` and `WAKU_PUBLIC_CONVEX_URL` set to the dev deployment URL.
3. No golden wire test differs from the commit that added it: `git log --follow --oneline -- '<path>'` shows one commit per file.
4. From `packages/backend`, with `CONVEX_DEPLOYMENT=dev:curious-pigeon-412` in `.env.local`: `npx convex dev --once`.
5. `npx convex logs` for a few minutes. The installed apps poll, so a broken function shows up quickly. On an error, redeploy the previous good origin/main commit and report.

The web app (Cloudflare) and the Notes Relay are not deployed by this migration. The installed iPhone and Mac builds are not rebuilt; Avi installs new builds when he chooses.

## Running the slices

- Give each implementer its brief as is. Each brief names its worktree, its files, its services, its traps, its done check and its report format.
- Each slice has its own e2e ports, so swarms can overlap. Each uses `E2E_WORKERS=3`; do not start more than two swarms at once on the 14-core Mac.
- Each slice posts its report as a comment on #90. The final slice reads them.
- If a slice stops half way, its commits on main are green by rule, and its brief still describes what is left.

## Risks

- **Effect 4 on Convex is new ground for this repo.** The reference builders pass on convex-test and a probe passed on a real local backend, but the foundation must repeat that check with the real builders before the fan-out.
- **`effect/reactivity` (Atom) is marked unstable** in 4.1. Pin `effect` exactly and upgrade all Effect packages together.
- **Speed on the web.** Atoms replace hand-tuned stores on the hot path. The web brief makes `e2e:perf` a gate and lets a store stay hand-rolled if an atom is slower.
- **Metro and Effect on the iPhone** are unproven until the mobile slice bundles the pattern component. It does that first.
- **Seven agents rebasing on one main.** Small commits and disjoint files keep conflicts rare; `pnpm-lock.yaml` and `convex/_generated` are the likely spots. Only the foundation, notes and final slices should need to touch a `package.json`.
- **Two planner slices share `planner/errors.ts` and `planner/tables.ts`.** Both belong to planner-structure; planner-time only imports them.
- **Bundle size.** Effect adds weight to every Convex module that imports it and to both client bundles. Watch the web build size in `pnpm check` output and the Convex push size at the first deploy.
- **The language service runs in editors only.** Its command-line diagnostics fail on TypeScript 6 here, so agents get Effect diagnostics from `tsc` types and tests, not from the plugin.

## Canvas

The Canvas workflow runner (issue #86) is built on Effect from its first line, not migrated to it later. It starts after the final slice, on these foundations:

- a run is a Job, so the runner is an Effect program at the Worker edge with one `ManagedRuntime` on the Mac;
- each node kind (a CLI command, an AI call, a file step) is a `Context.Service` with a live Layer and a test Layer, and the approval gate is a service too, so a test can run a whole canvas with no shell;
- node inputs, outputs and the canvas document read from the note's Y.Doc are decoded with Schema;
- failures are tagged errors with a `kind`, and cross the wire in the same format as everything else;
- timeouts, retries and cancellation use `Effect.timeout`, `Schedule` and fibre interruption, which is the part of Effect a workflow runner needs most;
- the canvas UI state on web and iPhone is atoms.

The `canvas-workflows` branch must rebase onto main after the final slice and follow `docs/effect.md` as written then.
