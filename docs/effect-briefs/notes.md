# Effect migration brief: notes backend, `packages/notes` and the relay

Issue: #90 on `mars-s/lifeos-app`. Model: Sonnet 5.5. Repo: `/Users/avi/Developer/projects/lifeos-app`.

You own the Notes backend, the shared notes package and the Notes Relay Worker. Only one of these files imports neverthrow, so this slice is small: its real work is the `RelayToken` service and Schema at the notes boundaries.

You implement. The patterns are already set: `docs/effect.md` holds the rules and points at reference code that compiles and is tested. Copy those patterns exactly. Where this brief and your habits disagree, the brief wins. Where the brief is silent, `node_modules/effect/AGENTS.md` wins. Avi is asleep: do not ask questions, pick the option closest to the reference code and list the choice in your report.

## Working rules

1. Worktree: `git fetch origin && git worktree add -b effect-notes ../lifeos-app-effect-notes origin/main`. Write `CONVEX_DEPLOYMENT=dev:curious-pigeon-412` to its `packages/backend/.env.local`, then run `pnpm install`.
2. Before you resume after a dropped connection, make sure no other agent is working in that worktree. One writer per worktree.
3. Read `AGENTS.md`, then `node_modules/effect/AGENTS.md` completely, then `docs/effect.md`, then `docs/effect-migration.md`. Open the reference files `docs/effect.md` lists and copy their patterns.
4. Small green commits straight to main, each ending with `(#90)`. Australian English, no em dashes, no prose comments in code.
5. Before every push: `git fetch origin && git rebase origin/main`, then `LIFEOS_CONVEX_URL=https://curious-pigeon-412.ap-southeast-2.convex.cloud WAKU_PUBLIC_CONVEX_URL=https://curious-pigeon-412.ap-southeast-2.convex.cloud pnpm check`, then `git push origin HEAD:main`. If the push is rejected, rebase and check again. Never force-push.
6. Touch only the files under "Your files". If something outside them must change, say so in your report and leave it.
7. This slice is user-facing, so run the e2e swarm once before your last push: `E2E_WEB_PORT=4305 E2E_CONVEX_PORT=3625 E2E_RELAY_PORT=8806 E2E_WORKERS=3 pnpm e2e`. Those ports are yours, so your run does not collide with another slice. It takes a while and it must be green. `node apps/e2e/src/failures.ts apps/e2e/out/results.json` prints each failure in a line or two. Never run `pnpm e2e:stop` against a stack you did not start.
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

- `packages/backend/convex/notes/agentReads.ts`
- `packages/backend/convex/notes/notes.ts` (imports neverthrow)
- `packages/backend/convex/notes/relay.ts`
- `packages/backend/convex/notes/tables.ts`
- `packages/notes/scripts/build-katex-style.ts`
- `packages/notes/src/catchup.ts`
- `packages/notes/src/client.ts`
- `packages/notes/src/editor/katex-style.gen.ts`
- `packages/notes/src/editor/live-preview.ts`
- `packages/notes/src/editor/math-preview.ts`
- `packages/notes/src/editor/note-editor.tsx`
- `packages/notes/src/editor/peers.ts`
- `packages/notes/src/env.d.ts`
- `packages/notes/src/markdown.ts`
- `packages/notes/src/math.ts`
- `packages/notes/src/presence.ts`
- `packages/notes/src/protocol.ts`
- `apps/relay/src/auth.ts`
- `apps/relay/src/env.ts`
- `apps/relay/src/index.ts`
- `apps/relay/src/note.ts`
- `apps/relay/src/projection.ts`
- `apps/relay/test/client.ts`
- `apps/relay/test/env.d.ts`
- `apps/relay/vitest.config.ts`

Tests:

- `apps/relay/test/presence.test.ts`
- `apps/relay/test/relay.test.ts`
- `packages/backend/convex/notes/notes.test.ts`
- `packages/notes/src/client.test.ts`
- `packages/notes/src/markdown.test.ts`
- `packages/notes/src/math.test.ts`

You may add `effect` (exactly `4.1.7`) to `packages/notes/package.json` and `apps/relay/package.json` if you use it there.

## Services this slice needs

You build: `RelayToken` in `convex/notes/relay.ts` (signs a relay token; live Layer reads the relay secret from Convex `env` as `Redacted`, test Layer returns a fixed token). From the foundation: `Reads`, `Writes`, `Recorder`, `CurrentActor`, `CurrentWorker`.

## What to do

1. Golden wire test first: `convex/notes/wire.test.ts`.
2. Error classes in `convex/notes/errors.ts` with a `SameWire` test against the old type.
3. Convert `convex/notes/notes.ts` and `convex/notes/relay.ts` to the Effect builders and `RelayToken`.
4. In `packages/notes` and `apps/relay`, use Schema only where JSON or a token is read from outside: the relay token claims in `apps/relay/src/auth.ts`, the Worker env in `apps/relay/src/env.ts`, and any JSON message in `packages/notes/src/protocol.ts`. Leave the Yjs binary sync loop, the CodeMirror editor and the Durable Object message path as plain code.
5. Convert a function to Effect when it has an expected failure, reads the clock, or uses an external dependency. A pure data helper stays a plain function. A helper that only reads through `ctx` and cannot fail may stay a promise function called through `reading(...)`; convert it when you need to compose it.

## Frozen exports

Plain, keep as they are: `convex/notes/agentReads.notesReadTools` (the ai slice mounts it), and everything `packages/notes` exports to the web and iPhone apps: `catchUpAll`, `NoteSync`, `RELAY_URL`, `bridgedOrigin`, `remoteOrigin`, `formatEntityLink`, `projectNote`, `titleKey`, `devicePresence`, `mirrorPeers`, `ownPresence`, `NOTE_META`, `NOTE_TEXT`, and the editor component.

## Traps

- The relay token format is a wire between the backend, the relay and the installed apps. Its claims and signing do not change.
- The relay is a Cloudflare Durable Object on the hot path of every keystroke. Do not run an Effect per message, and do not add a `ManagedRuntime` to the Worker for one decode: `Schema.decodeUnknownSync` or `decodeUnknownResult` at connect time is enough.
- Never run a deploy of the relay (`wrangler deploy`).
- Notes tests need unique titles, and the relay tests run in the Cloudflare vitest pool: keep `apps/relay/vitest.config.ts` as it is.
- Offline note editing must not change route or lose text. You touch no editor behaviour.
- `packages/notes` has `react` as a peer only. Do not add atoms here; client state is the web and iPhone slices' work.

## Done when

- `LIFEOS_CONVEX_URL=https://curious-pigeon-412.ap-southeast-2.convex.cloud WAKU_PUBLIC_CONVEX_URL=https://curious-pigeon-412.ap-southeast-2.convex.cloud pnpm check` is green on a commit rebased on origin/main.
- Your golden wire tests are byte-for-byte what your first commit added, and green.
- `git grep -n neverthrow -- <your files>` shows only `*Fx` twins' bridges and `effectFromNeverthrow` calls into other slices.
- `git grep -n "Effect\.run" -- <your files>` shows nothing outside the edges `docs/effect.md` allows.
- `pnpm e2e` is green (it covers Notes and the relay against a local stack).

## Report (short, plain words)

- Slice name, and your commits on main.
- What moved to Effect: files, services and Layers added (with their test Layers), error classes.
- Twins and bridges left for the final slice, by name.
- Wire: the golden test files, the `SameWire` tests, and anything that looked like a wire risk.
- Checks: `pnpm check`, `pnpm e2e` if this slice runs it, and anything else you ran, with results.
- Anything you left undone or changed outside your files, and why.
- Risks the final slice or Avi should know about.

Post the same report as a comment on issue #90 (`gh issue comment`), so the final slice can read it.
