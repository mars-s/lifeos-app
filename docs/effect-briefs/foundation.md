# Effect migration brief: foundation (platform, shared, transport)

Issue: #90 on `mars-s/lifeos-app`. Model: Opus 5.5. Repo: `/Users/avi/Developer/projects/lifeos-app`.

You go first and alone. Every other slice starts when you land, and copies what you build. Favour a small, exact, well-tested foundation over a broad one.

You implement. The patterns are already set: `docs/effect.md` holds the rules and points at reference code that compiles and is tested. Copy those patterns exactly. Where this brief and your habits disagree, the brief wins. Where the brief is silent, `node_modules/effect/AGENTS.md` wins. Avi is asleep: do not ask questions, pick the option closest to the reference code and list the choice in your report.

## Working rules

1. Worktree: `git fetch origin && git worktree add -b effect-foundation ../lifeos-app-effect-foundation origin/main`. Write `CONVEX_DEPLOYMENT=dev:curious-pigeon-412` to its `packages/backend/.env.local`, then run `pnpm install`.
2. Before you resume after a dropped connection, make sure no other agent is working in that worktree. One writer per worktree.
3. Read `AGENTS.md`, then `node_modules/effect/AGENTS.md` completely, then `docs/effect.md`, then `docs/effect-migration.md`. Open the reference files `docs/effect.md` lists and copy their patterns.
4. Small green commits straight to main, each ending with `(#90)`. Australian English, no em dashes, no prose comments in code.
5. Before every push: `git fetch origin && git rebase origin/main`, then `LIFEOS_CONVEX_URL=https://curious-pigeon-412.ap-southeast-2.convex.cloud WAKU_PUBLIC_CONVEX_URL=https://curious-pigeon-412.ap-southeast-2.convex.cloud pnpm check`, then `git push origin HEAD:main`. If the push is rejected, rebase and check again. Never force-push.
6. Touch only the files under "Your files". If something outside them must change, say so in your report and leave it.
7. This slice is user-facing, so run the e2e swarm once before your last push: `E2E_WEB_PORT=4300 E2E_CONVEX_PORT=3620 E2E_RELAY_PORT=8801 E2E_WORKERS=3 pnpm e2e`. Those ports are yours, so your run does not collide with another slice. It takes a while and it must be green. `node apps/e2e/src/failures.ts apps/e2e/out/results.json` prints each failure in a line or two. Never run `pnpm e2e:stop` against a stack you did not start.
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

You build the pieces the next section names (the bridge, `legacyRead`, `legacyChange`). Read it as the contract the seven parallel slices will follow, and follow it yourself inside `platform` and `shared`.

## Working beside the other slices

Seven slices run at once on disjoint files. Code in one slice calls code in another, and they will not land in a known order. So:

- **Frozen exports.** A function that another slice imports keeps its name and its exact signature until the final slice. Your frozen exports are listed below.
- **Twins.** When a frozen export returns a neverthrow `Result` or `ResultAsync`, write the real logic as an Effect in the same file under the same name plus `Fx` (`placeOnDay` and `placeOnDayFx`). The old name becomes a one-line bridge over the twin: `legacyRead(ctx, twinFx(...))` or `legacyChange(ctx, record, twinFx(...))` from `convex/platform/effect.ts`, or `toNeverthrow(...)` from `shared/effect/bridge.ts` for pure code. Inside your slice, call the twin.
- **Calling another slice.** If `<name>Fx` exists on origin/main, call it. If not, call the old function through `effectFromNeverthrow(() => old(...))` from `shared/effect/bridge.ts`. Plain `{ kind }` errors from old code pass through the wire encoder unchanged.
- **Registered functions are never twinned.** `export const create = changeMutation(...)` keeps its name. Agent tools reach it through `changeAs` and `readAsOwner`, which accept functions from either builder.
- Only `*Fx` twins and bridge calls may mention neverthrow in your files when you finish. The final slice deletes the old names, renames each `*Fx` to the plain name and removes the bridges.

## Your files

Source:

- `packages/backend/convex/auth.config.ts`
- `packages/backend/convex/auth.ts`
- `packages/backend/convex/convex.config.ts`
- `packages/backend/convex/crons.ts`
- `packages/backend/convex/http.ts`
- `packages/backend/convex/platform/access.ts`
- `packages/backend/convex/platform/activity.ts`
- `packages/backend/convex/platform/agentRuns.ts`
- `packages/backend/convex/platform/agentTools.ts` (imports neverthrow)
- `packages/backend/convex/platform/change.ts` (imports neverthrow)
- `packages/backend/convex/platform/features.ts` (imports neverthrow)
- `packages/backend/convex/platform/jobs.ts` (imports neverthrow)
- `packages/backend/convex/platform/links.ts` (imports neverthrow)
- `packages/backend/convex/platform/secrets.ts` (imports neverthrow)
- `packages/backend/convex/platform/tables.ts`
- `packages/backend/convex/platform/undo.ts` (imports neverthrow)
- `packages/backend/convex/platform/workers.ts`
- `packages/backend/convex/schema.ts`
- `packages/backend/shared/ai.ts`
- `packages/backend/shared/capture.ts`
- `packages/backend/shared/date.ts` (imports neverthrow)
- `packages/backend/shared/estimate.ts` (imports neverthrow)
- `packages/backend/shared/features.ts`
- `packages/backend/shared/focus.ts`
- `packages/backend/shared/plan.ts`
- `packages/backend/shared/recurrence.ts` (imports neverthrow)
- `packages/backend/shared/result.ts` (imports neverthrow)
- `packages/backend/shared/smartBlocks.ts`
- `packages/backend/shared/spread.ts`
- `packages/backend/shared/timeline.ts`
- `packages/backend/shared/types.ts`

New files you create: `packages/backend/convex/platform/effect.ts`, `packages/backend/convex/platform/effect.test.ts`, `packages/backend/shared/effect/bridge.ts`, `packages/backend/shared/effect/date.ts`, `packages/backend/shared/effect/estimate.ts`, `packages/backend/shared/effect/recurrence.ts`, `packages/backend/shared/client/backend.ts`, with tests beside them. Also yours: `docs/effect.md` and `.oxlintrc.json`.

Tests:

- `packages/backend/convex/auth.test.ts`
- `packages/backend/convex/backend.test-utils.ts`
- `packages/backend/convex/http.test.ts`
- `packages/backend/convex/platform/access.test.ts`
- `packages/backend/convex/platform/change.test.ts`
- `packages/backend/convex/platform/features.test.ts`
- `packages/backend/convex/platform/jobs.test.ts`
- `packages/backend/convex/platform/links.test.ts`
- `packages/backend/convex/platform/secrets.test.ts`
- `packages/backend/convex/platform/undo.test.ts`
- `packages/backend/shared/capture.test.ts`
- `packages/backend/shared/estimate.test.ts`
- `packages/backend/shared/recurrence.test.ts`
- `packages/backend/shared/smartBlocks.test.ts`
- `packages/backend/shared/spread.test.ts`
- `packages/backend/shared/timeline.test.ts`

Not yours: `packages/backend/convex/planner/errors.ts` and its test belong to the planner-structure slice, and `packages/backend/shared/client/` belongs to the web slice, except the one new file `backend.ts`.

## Services this slice needs

You build them: `Reads` (QueryCtx), `Writes` (MutationCtx), `Acts` (ActionCtx), `Recorder`, `CurrentActor`, `CurrentWorker`, all in `convex/platform/effect.ts`; `Secrets` in `convex/platform/secrets.ts` with `layer` and `layerTest`; `Backend` in `shared/client/backend.ts` (promote it from `shared/effect/patterns/atoms.ts`, with `layer(send)` and `layerTest(answers)`); `patterns/atoms.ts` then imports it from there and keeps only the atoms. The clock is Effect's own `Clock`.

## What to do

1. **Golden wire tests first** for `platform` (undo, jobs, secrets, features, links): `convex/platform/wire.test.ts`. Commit before any other change.
2. **Promote the builder sketch.** Move `shared/effect/patterns/convex.ts` to `convex/platform/effect.ts` and its test to `convex/platform/effect.test.ts`. Delete the two pattern files. Keep `runAtEdge` on the synchronous scheduler and keep the test that a `ConvexError` leaves unchanged. Add:
   - helpers `reading`, `writing`, `acting`, `recording`;
   - builders with the same names as today: `ownerQuery`, `ownerMutation`, `changeMutation`, `ownerAction`, `workerMutation`, `workerAction`, `agentQuery`, `agentMutation`, and Effect versions of `internalQuery`, `internalMutation`, `internalAction`. Each wraps the matching guard in `access.ts` (or the raw internal builder from `_generated/server`) and provides the services that kind of function may use. A change handler gets `Reads | Recorder | CurrentActor` and never `Writes`. Action builders run on the default scheduler, because actions may use timers;
   - `runChange(ctx, actor, action, effect)` for running a change's Effect in process, and `changeAsFx` and `readAsOwnerFx` for agent tools;
   - `legacyRead(ctx, effect)` and `legacyChange(ctx, record, effect)`: they run an Effect for an old caller and return a neverthrow `Result` whose error is the plain wire error.
3. **Keep both worlds working.** `changeAs` in `change.ts` and `readAsOwner` in `access.ts` must accept functions from either builder (register the Effect change in the same WeakMap through an adapter). Do not change the signatures of `access.ts` or `change.ts` exports: every other slice still imports them.
4. **Bridge:** `shared/effect/bridge.ts` exports `fromNeverthrow(result)`, `toNeverthrow(result)` (errors go through `wireError`), and `effectFromNeverthrow(thunk)` for a thunk returning a `Result`, a `Promise<Result>` or a `ResultAsync`. Test each.
5. **Shared parsers.** Write the Effect versions of `shared/date.ts`, `shared/estimate.ts` and `shared/recurrence.ts` under `shared/effect/` with the same export names, returning Effect's `Result` with the tagged errors in `shared/effect/errors.ts`. Then make each old neverthrow function a one-line `toNeverthrow` bridge over the new one, so there is one copy of the logic. Old signatures and error shapes do not change. Add a `SameWire` type test for `DateError`, `EstimateTextError` and `ScheduleError`.
6. **Migrate `platform`:** `features.ts`, `jobs.ts`, `links.ts`, `secrets.ts`, `undo.ts`, `agentTools.ts` and `change.test.ts` onto the new builders and services. Put their error classes in `convex/platform/errors.ts`. Convert a function to Effect when it has an expected failure, reads the clock, or uses an external dependency. A pure data helper stays a plain function. A helper that only reads through `ctx` and cannot fail may stay a promise function called through `reading(...)`; convert it when you need to compose it.
7. **Test helper:** add `runIn(t, effect)` to `convex/backend.test-utils.ts`. It runs an Effect inside `t.run` with `Reads` and `Writes` provided.
8. **Prove it on a real Convex runtime.** convex-test runs in edge-runtime, which has timers; Convex queries and mutations do not. In a scratch copy of `packages/backend` outside the repo, run a throwaway backend (`CONVEX_AGENT_MODE=anonymous npx convex dev`, with port flags if 3210 is taken), then `npx convex run` one migrated internal query and one migrated internal mutation. Stop only the processes you started. Never do this in a checkout that has the real link.
9. **Update `docs/effect.md`:** repoint the Convex row of the reference table to `convex/platform/effect.ts`, and document `legacyRead`, `legacyChange`, the bridge and `runIn` in a short "During the migration" section.
10. Run `E2E_WEB_PORT=4300 E2E_CONVEX_PORT=3620 E2E_RELAY_PORT=8801 E2E_WORKERS=3 pnpm e2e` once at the end: undo and features sit under every screen.

## Frozen exports

Everything `convex/platform/*` and `shared/*.ts` export today is frozen: names, signatures and error shapes. In particular `ownerQuery`, `ownerMutation`, `ownerAction`, `workerMutation`, `workerAction`, `agentQuery`, `agentMutation`, `readAsOwner`, `changeMutation`, `changeAs`, `startRecording`, `sameValue`, `featureReady`, `featureState`, `featureUses`, `writeFeature`, `revealSecret`, `secretAvailable`, `requireCapability`, `sha256Hex`, `platformTools`, `describeActivity`, `serialise`, `deserialise`, `vResult`, `parseIsoDate`, `parseEstimateText`, `parseSchedule`, `parseEnd`, `parseTimeZone`.

`changeAs` returns a neverthrow `Result` and is used by the ai slice: keep it, and add `changeAsFx` beside it.

## Traps

- Convex forbids `setTimeout` in queries and mutations ("Can't use setTimeout in queries and mutations"). The synchronous scheduler in `runAtEdge` is what keeps Effect legal there. This was checked on a real local backend with Effect 4.1.7; keep it checked (step 8).
- A defect must leave the function as the original thrown value. `ConvexError` carries `data` the apps read (`signed_out`, `not_owner`). Never let it arrive wrapped.
- `changeMutation` must keep the rule in `change.ts`: a change that fails after it wrote throws, so the transaction rolls back and no Activity is kept.
- `platform/activity.ts` imports `planner/rollups` and `ai/indexRows`. Those files belong to other slices. There is a known import cycle risk around the recorder: do not make `platform/effect.ts` import anything from `planner/` or `ai/`.
- `access.ts` is the only file allowed to import the raw `query`, `mutation` and `action` builders (oxlint enforces it). `platform/effect.ts` wraps `access.ts`; it does not need an exemption.
- The generic `changeMutation` return type must stay `SerialisedResult<T & { activityId }, Wire<E>>`. Check it in `effect.test.ts` with `expectTypeOf` against a hand-written type.
- `shared/` is imported by the web and iPhone apps. Keep `shared/effect/*` free of Convex server imports (`_generated/server`), or the apps will not bundle.
- oxlint rejects annotated return types, so `Effect.fn.Return` is out. Pin a contract with a typed variable or `satisfies`.

## Done when

- `LIFEOS_CONVEX_URL=https://curious-pigeon-412.ap-southeast-2.convex.cloud WAKU_PUBLIC_CONVEX_URL=https://curious-pigeon-412.ap-southeast-2.convex.cloud pnpm check` is green on a commit rebased on origin/main.
- Your golden wire tests are byte-for-byte what your first commit added, and green.
- `git grep -n neverthrow -- <your files>` shows only `*Fx` twins' bridges and `effectFromNeverthrow` calls into other slices.
- `git grep -n "Effect\.run" -- <your files>` shows nothing outside the edges `docs/effect.md` allows.
- The real-runtime check in step 8 passed, and your report says what you ran.
- `pnpm e2e` is green.
- Every other brief's instructions still hold against what you built: the names in step 2 and step 4 exist exactly as written.

## Report (short, plain words)

- Slice name, and your commits on main.
- What moved to Effect: files, services and Layers added (with their test Layers), error classes.
- Twins and bridges left for the final slice, by name.
- Wire: the golden test files, the `SameWire` tests, and anything that looked like a wire risk.
- Checks: `pnpm check`, `pnpm e2e` if this slice runs it, and anything else you ran, with results.
- Anything you left undone or changed outside your files, and why.
- Risks the final slice or Avi should know about.

Post the same report as a comment on issue #90 (`gh issue comment`), so the final slice can read it.
