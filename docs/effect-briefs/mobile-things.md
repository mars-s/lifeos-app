# Effect migration brief: the iPhone client, the Things import and things-sync

Issue: #90 on `mars-s/lifeos-app`. Model: Sonnet 5.5. Repo: `/Users/avi/Developer/projects/lifeos-app`.

You own the iPhone app, the one-way Things import on the backend and the `things-sync` program that feeds it. The import is mechanical. The iPhone app needs care with Metro and with offline launch. If either resists, stop at a green state and report.

You implement. The patterns are already set: `docs/effect.md` holds the rules and points at reference code that compiles and is tested. Copy those patterns exactly. Where this brief and your habits disagree, the brief wins. Where the brief is silent, `node_modules/effect/AGENTS.md` wins. Avi is asleep: do not ask questions, pick the option closest to the reference code and list the choice in your report.

## Working rules

1. Worktree: `git fetch origin && git worktree add -b effect-mobile-things ../lifeos-app-effect-mobile-things origin/main`. Write `CONVEX_DEPLOYMENT=dev:curious-pigeon-412` to its `packages/backend/.env.local`, then run `pnpm install`.
2. Before you resume after a dropped connection, make sure no other agent is working in that worktree. One writer per worktree.
3. Read `AGENTS.md`, then `node_modules/effect/AGENTS.md` completely, then `docs/effect.md`, then `docs/effect-migration.md`. Open the reference files `docs/effect.md` lists and copy their patterns.
4. Small green commits straight to main, each ending with `(#90)`. Australian English, no em dashes, no prose comments in code.
5. Before every push: `git fetch origin && git rebase origin/main`, then `LIFEOS_CONVEX_URL=https://curious-pigeon-412.ap-southeast-2.convex.cloud WAKU_PUBLIC_CONVEX_URL=https://curious-pigeon-412.ap-southeast-2.convex.cloud pnpm check`, then `git push origin HEAD:main`. If the push is rejected, rebase and check again. Never force-push.
6. Touch only the files under "Your files". If something outside them must change, say so in your report and leave it.
7. This slice has no web surface of its own, so it does not run `pnpm e2e`.
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

Everything under `apps/mobile/src/`, `apps/things-sync/`, `packages/widget-kit/`, and these backend files:

- `packages/backend/convex/planner/things.ts` (imports neverthrow)
- `packages/backend/convex/planner/thingsImport.ts` (imports neverthrow)
- `packages/backend/convex/planner/thingsRows.ts` (imports neverthrow)
- `packages/backend/convex/planner/things.test-utils.ts`
- `packages/backend/convex/planner/things.test.ts`
- `packages/backend/convex/planner/thingsRows.test.ts`

Import neverthrow:

- `apps/mobile/src/components/home-pages.tsx`
- `apps/mobile/src/lib/timeline.ts`
- `apps/mobile/src/lib/views.ts`
- `apps/things-sync/src/main.ts`
- `apps/things-sync/src/things.ts`
- `packages/backend/convex/planner/things.ts`
- `packages/backend/convex/planner/thingsImport.ts`
- `packages/backend/convex/planner/thingsRows.ts`

Hand-rolled stores on the iPhone:

- `apps/mobile/src/lib/focus.tsx`
- `apps/mobile/src/lib/notes/data.ts`
- `apps/mobile/src/lib/notes/library.ts`
- `apps/mobile/src/lib/notes/use-note.ts`
- `apps/mobile/src/lib/tasks.ts`
- `apps/mobile/src/lib/timeline.ts`
- `apps/mobile/src/lib/views.ts`

New files you create: `apps/mobile/src/lib/runtime.ts`, `apps/mobile/src/lib/atoms.ts`, `packages/backend/convex/planner/thingsWire.test.ts`.

## Services this slice needs

You build: `ThingsSource` in `apps/things-sync/src/things.ts` (finds and reads the Things database; live Layer reads SQLite read-only, test Layer serves fixture rows). On the iPhone: `Backend` from `@lifeos/backend/client/backend` with the app's Convex client, and `KeyValueStore` over `expo-sqlite/kv-store` through a small adapter (its synchronous methods are `getItemSync`, `setItemSync`, `removeItemSync`). From the foundation: `Reads`, `Writes`, `CurrentWorker`, `workerMutation`, `workerAction`.

## What to do

1. **Things import (backend).** Golden wire test first, `convex/planner/thingsWire.test.ts`, for the worker endpoints in `planner/things.ts`. Then convert `thingsRows.ts` (decode rows with Schema), `thingsImport.ts` and `things.ts` to the Effect `workerMutation`.
2. **things-sync.** `ThingsSource` with its Layers; `main.ts` builds the Layer and runs one program with `Effect.runPromise` at the bottom of the file, the only `run` call. Read results from the backend with `wireToEffect`. Its tests run on `node --test`: keep that runner, and run Effects in them with `Effect.runPromise`.
3. **iPhone plumbing.** First prove Metro bundles Effect: import the pattern component from `src/lib/effect/atoms.pattern.tsx` in one screen and run `LANG=en_US.UTF-8 pnpm build:mobile`. Then add `src/lib/atoms.ts` (registry, mounted once at the root layout with `RegistryContext.Provider`) and `src/lib/runtime.ts`.
4. **neverthrow out** of the three iPhone files. `Result.fromThrowable(() => prefs.getItemSync(...))` becomes `Atom.kvs` with a Schema, or `Result.try` where an atom does not fit.
5. **Stores to atoms**, one per commit, keeping each store's exported functions and hooks exactly as they are.
6. Load `vercel-react-native-skills` before the iPhone work. Remove the pattern file once two real stores show the same thing, and tell the final slice.
7. Convert a function to Effect when it has an expected failure, reads the clock, or uses an external dependency. A pure data helper stays a plain function. A helper that only reads through `ctx` and cannot fail may stay a promise function called through `reading(...)`; convert it when you need to compose it.

## Frozen exports

Plain, keep as they are: nothing in your backend files is imported by another slice except through registered worker endpoints, which keep their names.

You call planner-structure helpers `labels.labelNamed`, `model.keyAfter`, `model.lastTaskOrder` (plain) and `shared/date.parseIsoDate` (use `shared/effect/date`).

The iPhone app imports `packages/backend/shared/client/*`, which the web slice owns and keeps frozen.

## Traps

- **Never write to Things. Never run `pnpm things:switch` or `pnpm sync:things`.** Test with fixtures only. Do not read the real Things database or the Keychain token.
- things-sync runs from Avi's checkout against the live backend, so its wire to `planner/things.ts` is as fixed as the apps' wire.
- The installed iPhone build embeds its own JavaScript, so your changes do not reach it. Still keep the app building: `pnpm --filter @lifeos/mobile typecheck` and `LANG=en_US.UTF-8 pnpm build:mobile` must pass.
- Offline launch depends on the saved views in `src/lib/views.ts` and the owner gate. `parseSaved` must still return the saved view for every value an older build wrote: decode leniently, and fall back to no view on a bad value, as today.
- Metro skips `url()` fonts and hoists CSS in DOM components; do not move CSS around. `pod install` and `run:ios` need `LANG=en_US.UTF-8`.
- If you check on a simulator, use the device tools named in your environment, not `xcrun simctl` for interaction. A device check is welcome, not required.
- `apps/mobile/src/components/ui/` and `src/lib/kit.tsx` are ExpoKit code. Do not edit them.
- Reanimated worklets cannot read atoms. Pass values in as shared values, as the code does today.

## Done when

- `LIFEOS_CONVEX_URL=https://curious-pigeon-412.ap-southeast-2.convex.cloud WAKU_PUBLIC_CONVEX_URL=https://curious-pigeon-412.ap-southeast-2.convex.cloud pnpm check` is green on a commit rebased on origin/main.
- Your golden wire tests are byte-for-byte what your first commit added, and green.
- `git grep -n neverthrow -- <your files>` shows only `*Fx` twins' bridges and `effectFromNeverthrow` calls into other slices.
- `git grep -n "Effect\.run" -- <your files>` shows nothing outside the edges `docs/effect.md` allows.
- `pnpm --filter @lifeos/things-sync test` is green.
- `LANG=en_US.UTF-8 pnpm build:mobile` passes.

## Report (short, plain words)

- Slice name, and your commits on main.
- What moved to Effect: files, services and Layers added (with their test Layers), error classes.
- Twins and bridges left for the final slice, by name.
- Wire: the golden test files, the `SameWire` tests, and anything that looked like a wire risk.
- Checks: `pnpm check`, `pnpm e2e` if this slice runs it, and anything else you ran, with results.
- Anything you left undone or changed outside your files, and why.
- Risks the final slice or Avi should know about.

Post the same report as a comment on issue #90 (`gh issue comment`), so the final slice can read it.
