# Effect migration brief: final (remove neverthrow, fold the twins, deploy)

Issue: #90 on `mars-s/lifeos-app`. Model: Opus 5.5. Repo: `/Users/avi/Developer/projects/lifeos-app`.

You go last and alone, after every other slice has landed on main. You remove what the migration needed and the finished app does not.

You implement. The patterns are already set: `docs/effect.md` holds the rules and points at reference code that compiles and is tested. Copy those patterns exactly. Where this brief and your habits disagree, the brief wins. Where the brief is silent, `node_modules/effect/AGENTS.md` wins. Avi is asleep: do not ask questions, pick the option closest to the reference code and list the choice in your report.

## Working rules

1. Worktree: `git fetch origin && git worktree add -b effect-final ../lifeos-app-effect-final origin/main`. Write `CONVEX_DEPLOYMENT=dev:curious-pigeon-412` to its `packages/backend/.env.local`, then run `pnpm install`.
2. Before you resume after a dropped connection, make sure no other agent is working in that worktree. One writer per worktree.
3. Read `AGENTS.md`, then `node_modules/effect/AGENTS.md` completely, then `docs/effect.md`, then `docs/effect-migration.md`. Open the reference files `docs/effect.md` lists and copy their patterns.
4. Small green commits straight to main, each ending with `(#90)`. Australian English, no em dashes, no prose comments in code.
5. Before every push: `git fetch origin && git rebase origin/main`, then `LIFEOS_CONVEX_URL=https://curious-pigeon-412.ap-southeast-2.convex.cloud WAKU_PUBLIC_CONVEX_URL=https://curious-pigeon-412.ap-southeast-2.convex.cloud pnpm check`, then `git push origin HEAD:main`. If the push is rejected, rebase and check again. Never force-push.
6. Touch only the files under "Your files". If something outside them must change, say so in your report and leave it.
7. This slice is user-facing, so run the e2e swarm once before your last push: `E2E_WEB_PORT=4290 E2E_CONVEX_PORT=3610 E2E_RELAY_PORT=8791 E2E_WORKERS=3 pnpm e2e`. Those ports are yours, so your run does not collide with another slice. It takes a while and it must be green. `node apps/e2e/src/failures.ts apps/e2e/out/results.json` prints each failure in a line or two. Never run `pnpm e2e:stop` against a stack you did not start.
8. You deploy Convex once, at the end, as the steps below say: only from a pushed commit that equals origin/main, with `pnpm check` green and the wire tests untouched, with `npx convex dev --once` from `packages/backend`. A deploy must keep the installed iPhone and Mac apps working.
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

The next section is what the seven parallel slices followed. It tells you what you will find and must now undo.

## Working beside the other slices

Seven slices run at once on disjoint files. Code in one slice calls code in another, and they will not land in a known order. So:

- **Frozen exports.** A function that another slice imports keeps its name and its exact signature until the final slice. Your frozen exports are listed below.
- **Twins.** When a frozen export returns a neverthrow `Result` or `ResultAsync`, write the real logic as an Effect in the same file under the same name plus `Fx` (`placeOnDay` and `placeOnDayFx`). The old name becomes a one-line bridge over the twin: `legacyRead(ctx, twinFx(...))` or `legacyChange(ctx, record, twinFx(...))` from `convex/platform/effect.ts`, or `toNeverthrow(...)` from `shared/effect/bridge.ts` for pure code. Inside your slice, call the twin.
- **Calling another slice.** If `<name>Fx` exists on origin/main, call it. If not, call the old function through `effectFromNeverthrow(() => old(...))` from `shared/effect/bridge.ts`. Plain `{ kind }` errors from old code pass through the wire encoder unchanged.
- **Registered functions are never twinned.** `export const create = changeMutation(...)` keeps its name. Agent tools reach it through `changeAs` and `readAsOwner`, which accept functions from either builder.
- Only `*Fx` twins and bridge calls may mention neverthrow in your files when you finish. The final slice deletes the old names, renames each `*Fx` to the plain name and removes the bridges.

## Your files

The whole repo, once the other seven slices are on main. Check that first: `git log --oneline origin/main | grep -c "(#90)"` and read each slice's report in the issue.

## Services this slice needs

None new. You check that every dependency in the table in `docs/effect.md` has its service, its live Layer and its test Layer, and add any that a slice left out.

## What to do

1. **Inventory.** `git grep -n "neverthrow"`, `git grep -nE "[a-z]Fx\b"`, `git grep -n "effectFromNeverthrow\|fromNeverthrow\|toNeverthrow\|legacyRead\|legacyChange"`. Every hit is yours to remove.
2. **Fold the twins.** For each `nameFx`: delete the old `name`, rename `nameFx` to `name` everywhere, and replace each bridge call with a direct call. Do it one module at a time with a green `pnpm check` between.
3. **Fold shared.** Move `shared/effect/date.ts`, `estimate.ts` and `recurrence.ts` over `shared/date.ts`, `estimate.ts` and `recurrence.ts`. Move `shared/effect/errors.ts` to `shared/errors.ts`. Move the transport from `shared/effect/wire.ts` into `shared/result.ts`, where `SerialisedResult` and `vResult` already live, and delete `serialise` and `deserialise`. Rewrite the imports and the `exports` map in `packages/backend/package.json` (`@lifeos/backend/result` stays the name the apps import). `shared/effect/` no longer exists when you finish.
4. **Retire the old path.** Delete `shared/effect/bridge.ts`, the neverthrow `changeMutation` and `changeAs` in `platform/change.ts` (fold what remains into `platform/effect.ts`), `legacyRead`, `legacyChange`, every `*.pattern.*` file and `shared/effect/patterns/`. Delete each old plain error union (`PlannerError` and the rest) once nothing imports it, and turn each `SameWire` test into a check against a literal type written out in the test, so the wire stays pinned.
5. **Remove the dependency.** Take `neverthrow` out of every `package.json` and the lockfile.
6. **Ban it in oxlint.** In `.oxlintrc.json`, add `neverthrow` to `no-restricted-imports` `paths` with the message "Use Effect. See docs/effect.md.". Restrict the builders exported by `convex/platform/access.ts` to `convex/platform/effect.ts` in the same rule, so every function is built with the Effect builders.
7. **Docs.** Rewrite the Effect lines in `AGENTS.md` to the finished state (no "being removed"), repoint the reference table in `docs/effect.md` to real code (`convex/platform/effect.ts`, `convex/health/oura.ts`, the apps' `lib/atoms.ts`), drop its "During the migration" section, and mark `docs/effect-migration.md` done at the top. Keep the briefs as history.
8. **Full checks.** `pnpm check`, `pnpm e2e` on the default ports, `pnpm e2e:perf`, `pnpm --filter @lifeos/things-sync test`, `LANG=en_US.UTF-8 pnpm build:mobile`.
9. **Deploy**, following "Deploys" in `docs/effect-migration.md`: from a pushed commit equal to origin/main, `npx convex dev --once` in `packages/backend`, then watch `npx convex logs` for errors for a few minutes while the installed apps poll. Do not deploy the web app or the relay.

## Frozen exports

None of your own. The only things still frozen are the wire contract itself and the names the apps import from `@lifeos/backend/*`.

## Traps

- **The wire does not change in this slice either.** "Retiring the old wire path" means deleting the neverthrow code that produced and read it. The JSON stays. The golden wire tests from every slice must be untouched and green before and after each step.
- A rename with `sed` can hit a word inside another word. Use word boundaries, run typecheck after each module, and read the diff.
- Deleting `changeAs` breaks the agent tools unless the ai slice already moved to `changeAsFx`. Rename `changeAsFx` to `changeAs` rather than leaving two names.
- `convex/_generated` must be committed after function or schema changes; generate it in a scratch copy, never against the real link.
- Deploy only from a commit that contains everything on origin/main, and push before you deploy. A stale deploy removes functions the live web app needs.
- If a slice reported a kept hand-rolled store or a kept neverthrow corner with a reason, respect the reason or fix it properly. Do not paper over it to make the grep clean.
- The Canvas workflow runner (issue #86) starts after you. It is built on Effect from its first line (`docs/effect-migration.md`, "Canvas"). Leave nothing in `docs/effect.md` that would teach it a migration-era pattern.

## Done when

- `git grep -n neverthrow` finds nothing outside `docs/effect-briefs/`, `docs/effect-migration.md` and the oxlint message.
- `git grep -nE "[a-z]Fx\b" -- '*.ts' '*.tsx'` finds nothing.
- `packages/backend/shared/effect/` is gone.
- All the checks in step 8 are green.
- The dev deployment runs the final commit, its logs are clean, and that commit is on origin/main.
- The issue #90 has a closing comment with the summary, and is closed.

## Report (short, plain words)

- Slice name, and your commits on main.
- What moved to Effect: files, services and Layers added (with their test Layers), error classes.
- Twins and bridges left for the final slice, by name.
- Wire: the golden test files, the `SameWire` tests, and anything that looked like a wire risk.
- Checks: `pnpm check`, `pnpm e2e` if this slice runs it, and anything else you ran, with results.
- Anything you left undone or changed outside your files, and why.
- Risks the final slice or Avi should know about.

Post the same report as a comment on issue #90 (`gh issue comment`), so the final slice can read it.
