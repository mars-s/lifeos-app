# Effect migration brief: the web client (and the Mac app's web view)

Issue: #90 on `mars-s/lifeos-app`. Model: Opus 5.5. Repo: `/Users/avi/Developer/projects/lifeos-app`.

You own the web app and the shared client code. The Mac app is this same web app in a Tauri window. Nothing may look or feel different when you finish: this is a change of plumbing under a UI that Avi holds to the level of Things 3.

You implement. The patterns are already set: `docs/effect.md` holds the rules and points at reference code that compiles and is tested. Copy those patterns exactly. Where this brief and your habits disagree, the brief wins. Where the brief is silent, `node_modules/effect/AGENTS.md` wins. Avi is asleep: do not ask questions, pick the option closest to the reference code and list the choice in your report.

## Working rules

1. Worktree: `git fetch origin && git worktree add -b effect-web ../lifeos-app-effect-web origin/main`. Write `CONVEX_DEPLOYMENT=dev:curious-pigeon-412` to its `packages/backend/.env.local`, then run `pnpm install`.
2. Before you resume after a dropped connection, make sure no other agent is working in that worktree. One writer per worktree.
3. Read `AGENTS.md`, then `node_modules/effect/AGENTS.md` completely, then `docs/effect.md`, then `docs/effect-migration.md`. Open the reference files `docs/effect.md` lists and copy their patterns.
4. Small green commits straight to main, each ending with `(#90)`. Australian English, no em dashes, no prose comments in code.
5. Before every push: `git fetch origin && git rebase origin/main`, then `LIFEOS_CONVEX_URL=https://curious-pigeon-412.ap-southeast-2.convex.cloud WAKU_PUBLIC_CONVEX_URL=https://curious-pigeon-412.ap-southeast-2.convex.cloud pnpm check`, then `git push origin HEAD:main`. If the push is rejected, rebase and check again. Never force-push.
6. Touch only the files under "Your files". If something outside them must change, say so in your report and leave it.
7. This slice is user-facing, so run the e2e swarm once before your last push: `E2E_WEB_PORT=4306 E2E_CONVEX_PORT=3626 E2E_RELAY_PORT=8807 E2E_WORKERS=3 pnpm e2e`. Those ports are yours, so your run does not collide with another slice. It takes a while and it must be green. `node apps/e2e/src/failures.ts apps/e2e/out/results.json` prints each failure in a line or two. Never run `pnpm e2e:stop` against a stack you did not start.
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

Everything under `apps/web/src/`, the TypeScript under `apps/desktop/` (never the Rust), and `packages/backend/shared/client/` except `backend.ts`, which the foundation slice owns. The files that matter:

Import neverthrow:

- `apps/web/src/components/app/new-task-place.ts`
- `apps/web/src/components/app/planner/drag.tsx`
- `apps/web/src/components/app/task-item.tsx`
- `packages/backend/shared/client/genui.ts`

Hand-rolled `useSyncExternalStore` stores:

- `apps/web/src/components/app/ai/open-run.ts`
- `apps/web/src/components/app/command-bar/store.ts`
- `apps/web/src/components/app/confirm.tsx`
- `apps/web/src/components/app/drafts.ts`
- `apps/web/src/components/app/focus.tsx`
- `apps/web/src/components/app/hooks.ts`
- `apps/web/src/components/app/reverted-views.ts`
- `apps/web/src/components/app/row-window.tsx`
- `apps/web/src/components/app/selection.ts`
- `apps/web/src/components/app/settings/mac-state.ts`
- `apps/web/src/components/app/settings/welcome-replay.ts`
- `apps/web/src/components/app/window-drag-strip.tsx`
- `apps/web/src/components/connect-page.tsx`
- `apps/web/src/components/notes/data.ts`
- `apps/web/src/components/notes/note-beside.tsx`
- `apps/web/src/components/notes/stored.ts`
- `apps/web/src/components/notes/task-beside.tsx`
- `apps/web/src/components/notes/use-note.ts`
- `apps/web/src/lib/alerts.ts`
- `apps/web/src/lib/mac.ts`

Read a Result from a mutation or an action (`.ok`, `error.kind`):

- `apps/web/src/components/app/ai/ask-box.tsx`
- `apps/web/src/components/app/ai/run-strip.tsx`
- `apps/web/src/components/app/ai/task-ask.ts`
- `apps/web/src/components/app/calendars-setting.tsx`
- `apps/web/src/components/app/capture-window.tsx`
- `apps/web/src/components/app/hooks.ts`
- `apps/web/src/components/app/oura.ts`
- `apps/web/src/components/app/planner/actions.ts`
- `apps/web/src/components/app/planner/smart-blocks.tsx`
- `apps/web/src/components/app/screens/templates.tsx`
- `apps/web/src/components/app/settings/memory-settings.tsx`
- `apps/web/src/components/app/settings/places-settings.tsx`
- `apps/web/src/components/app/settings/provider-keys.tsx`
- `apps/web/src/components/app/trash-actions.ts`
- `apps/web/src/components/app/widget-sync.tsx`
- `apps/web/src/components/notes/daily.tsx`
- `packages/backend/shared/client/change.ts`
- `packages/backend/shared/client/repeat-actions.ts`
- `packages/backend/shared/client/updaters.ts`

New files you create: `apps/web/src/lib/runtime.ts`, `apps/web/src/lib/atoms.ts`.

## Services this slice needs

`Backend` from `@lifeos/backend/client/backend` (built by the foundation): give it the app's Convex client in `src/lib/runtime.ts`. `KeyValueStore` from `effect/persistence` with `layerStorage(() => localStorage)` for saved preferences, `layerMemory` in tests. One `ManagedRuntime` and one `Atom.runtime` built from the same Layer.

## What to do

1. Load `vercel-react-best-practices` and `vercel-composition-patterns` before you start.
2. **Plumbing.** `src/lib/atoms.ts` exports the app registry (`AtomRegistry.make({ scheduleTask })` with `scheduleTask` from `@effect/atom-react`). Mount it once at the root with `RegistryContext.Provider`. `src/lib/runtime.ts` exports the `ManagedRuntime` and the `Atom.runtime`.
3. **neverthrow out.** `Result.fromThrowable` becomes `Result.try` from `effect`. JSON read from storage or a drag payload is decoded with a Schema (`new-task-place.ts` parses JSON by hand today).
4. **Stores to atoms**, one store per commit. Keep each store's exported functions and hooks exactly as they are, and change only what is inside: state in atoms, readers through `useAtomValue`, writers through the registry. Code outside React keeps calling the same functions.
5. **Mutations with their own state.** Where a component keeps pending or error state in `useState` around a mutation or an action, move the call to `runtime.fn<Args>()(...)` over `Backend` and read the `AsyncResult`. A change sent through `createChange` (optimistic, with undo) stays on `createChange`.
6. **Saved preferences** become `Atom.kvs` with a Schema.
7. Remove `apps/web/src/lib/effect/atoms.pattern.tsx` and its test once two real stores show the same thing. Do not edit `docs/effect.md`: name the two stores in your report, and the final slice repoints it.
8. Run `web-design-guidelines` over each UI file you changed.

## Frozen exports

`packages/backend/shared/client/*` is imported by the iPhone app. Every export there keeps its name and signature, in particular `createChange`, `noDrafts`, `taskActions`, `focusActions`, `repeatActions`, `switchFeature`, the `updaters`, `view-cache` and `reverted` functions, `taskAliases` and `createUndoStack`.

The backend's public functions and their types are frozen for you by the wire contract. You change no backend file.

## Traps

- **Speed.** Every interaction must answer within a frame. `selection.ts`, `row-window.tsx`, the drag code and `command-bar/store.ts` are on the hot path. After you convert one, run `E2E_WEB_PORT=4390 E2E_CONVEX_PORT=3710 pnpm e2e:perf` on a quiet machine and compare with a run on origin/main. If an atom is slower than the hand-rolled store and you cannot fix it, keep the store, and report it.
- The registry schedules its housekeeping with React's scheduler. Check that `registry.set` reaches subscribers synchronously for the hot stores before you rely on it.
- The Planner stays mounted behind the lists in a React `Activity` and reads a frozen copy of the shell while hidden (commit `fd07303`). Atoms read inside it must not wake it while hidden.
- An atom with no reader is disposed and loses its value. A store that must survive (selection, drafts, the command bar) needs `Atom.keepAlive`.
- Waku renders on the server first. A module that touches `localStorage` or the registry at import time breaks the build: keep those behind `"use client"` and inside Layers.
- Server data stays on Convex `useQuery` and the saved views. Do not copy query results into atoms.
- Sign-in state per browser context matters to e2e screenshots; you change none of it.
- Leave `apps/web/src/components/design-board/` alone: it is reference UI.
- `apps/web/src/components/ui/` is generated TuffUI code and is ignored by oxlint. Do not edit it.
- Do not run `pnpm --filter @lifeos/web deploy`.

## Done when

- `LIFEOS_CONVEX_URL=https://curious-pigeon-412.ap-southeast-2.convex.cloud WAKU_PUBLIC_CONVEX_URL=https://curious-pigeon-412.ap-southeast-2.convex.cloud pnpm check` is green on a commit rebased on origin/main.
- Your golden wire tests are byte-for-byte what your first commit added, and green.
- `git grep -n neverthrow -- <your files>` shows only `*Fx` twins' bridges and `effectFromNeverthrow` calls into other slices.
- `git grep -n "Effect\.run" -- <your files>` shows nothing outside the edges `docs/effect.md` allows.
- `E2E_WEB_PORT=4306 E2E_CONVEX_PORT=3626 E2E_RELAY_PORT=8807 E2E_WORKERS=3 pnpm e2e` is green.
- `pnpm e2e:perf` shows no interaction slower than on origin/main beyond noise; the numbers are in your report.
- `git grep -n useSyncExternalStore -- apps/web/src ':!apps/web/src/components/ui' ':!apps/web/src/components/design-board'` shows only stores you reported as kept, with the reason.

## Report (short, plain words)

- Slice name, and your commits on main.
- What moved to Effect: files, services and Layers added (with their test Layers), error classes.
- Twins and bridges left for the final slice, by name.
- Wire: the golden test files, the `SameWire` tests, and anything that looked like a wire risk.
- Checks: `pnpm check`, `pnpm e2e` if this slice runs it, and anything else you ran, with results.
- Anything you left undone or changed outside your files, and why.
- Risks the final slice or Avi should know about.

Post the same report as a comment on issue #90 (`gh issue comment`), so the final slice can read it.
