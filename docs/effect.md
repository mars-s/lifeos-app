# Effect in LifeOS

LifeOS uses [Effect](https://effect.website) 4 for expected failures, dependency injection, boundary decoding and client state. It replaces neverthrow. The move is in progress: `docs/effect-migration.md` has the plan and `docs/effect-briefs/` has one brief per slice.

## Read first

1. `node_modules/effect/AGENTS.md`, completely. It ships with the installed version, so it is never out of date. Follow its links into `node_modules/effect/ai-docs/` when you need a topic.
2. The reference code below. It compiles, it is tested, and you copy it.
3. For an API this page does not cover, search `node_modules/effect/src`. Do not use web docs or memory: most of what is online describes Effect 3, and names changed (`Context.Tag` and `Effect.Service` are now `Context.Service`, `Either` is `Result`, `Schema.decodeUnknown` is `Schema.decodeUnknownEffect`).

| Pattern | Reference file | Test |
| --- | --- | --- |
| Result transport | `packages/backend/shared/effect/wire.ts` | `wire.test.ts` |
| Tagged errors | `packages/backend/convex/planner/errors.ts`, `packages/backend/shared/effect/errors.ts` | `errors.test.ts` |
| Convex builders, services and edges | `packages/backend/convex/platform/effect.ts` | `effect.test.ts` |
| A real module on the builders | `packages/backend/convex/platform/undo.ts`, `jobs.ts`, `links.ts` | `wire.test.ts`, `undo.test.ts` |
| Service over Convex and HTTP, live and test Layers | `packages/backend/convex/platform/secrets.ts` | `secrets.layer.test.ts` |
| Service, live and test Layers, Schema boundary | `packages/backend/shared/effect/patterns/oura.ts` | `oura.test.ts` |
| Client `Backend` service | `packages/backend/shared/client/backend.ts` | `backend.test.ts` |
| Atoms | `packages/backend/shared/effect/patterns/atoms.ts` | `atoms.test.ts` |
| Atoms from React | `apps/web/src/lib/effect/atoms.pattern.tsx` | `atoms.pattern.test.tsx` |
| Atoms from React Native | `apps/mobile/src/lib/effect/atoms.pattern.tsx` | typecheck |

Files under `patterns/` and files named `*.pattern.*` are references. The Convex sketch is now `convex/platform/effect.ts`; the last slice deletes the rest once real code shows the same thing.

## Packages

- `effect` 4.1.7 everywhere. One version across the repo: pin it exactly and upgrade every package together.
- `@effect/vitest` 4.1.7 for tests, `@effect/atom-react` 4.1.7 for React and React Native.
- `@effect/language-service` is a TypeScript plugin in `tsconfig.base.json` and `apps/mobile/tsconfig.json`. Set your editor to the workspace TypeScript to get its diagnostics.
- Not used: `@effect-atom/atom` and `@rjdellecese/confect` (both need Effect 3), `@confect/*` (see Choices), `effect-mcp` (serves Effect 3 era docs).

## Style

- Inline Effect code is `Effect.gen`. A reusable function is `Effect.fn("module.name")(function* (...) { ... })`, with the span name matching the function. Do not write a function that only wraps `Effect.gen`.
- Attach behaviour with `.pipe(...)`: `Effect.provide`, `Effect.mapError`, `Effect.retry`, `Effect.withSpan`. Do not build logic out of long pipe chains; use a generator.
- Fail with `return yield* new SomeError({ ... })`. Always `return`, so TypeScript knows the function stops there.
- Never annotate a return type (oxlint rejects it, and `Effect.fn.Return` counts). Let the error and requirement channels be inferred.
- Pure, synchronous code that can fail returns `Result.Result<A, E>` from `effect`, combined with `Result.gen` or `Result.all`. Lift it with `Effect.fromResult`. Anything that reads the database, calls the network, needs a service or reads the clock returns an `Effect`.
- Read time with `Clock.currentTimeMillis` or `DateTime`, not `Date.now()`, so tests can move the clock.
- No prose comments, Australian English, no em dashes. These rules have not changed.

```ts
export const parseTitle = (title: string) =>
  title.trim() ? Result.succeed(title.trim()) : Result.fail(new EmptyTitle());

const loadArea = Effect.fn("areas.load")(function* (areaId: Id<"areas">) {
  const area = yield* reading((ctx) => ctx.db.get("areas", areaId));
  if (!area) return yield* new NotFound({ table: "areas", id: areaId });
  return area;
});
```

## Errors

An expected failure is a `Schema.TaggedError` class. A bug or a broken invariant is a thrown error (a defect), exactly as before: do not put it in the error channel.

```ts
export class InvalidBlock extends Schema.TaggedError<InvalidBlock>()("InvalidBlock", {
  kind: Schema.tag("invalid_block"),
  reason: Schema.Literals(["start", "minutes", "time_zone", "overlap"]),
}) {}
```

- `_tag` is the PascalCase class name. It is unique across the repo, so `Effect.catchTag` never catches another module's error.
- `kind` is the snake_case word the apps, the database and the MCP tools already read. `Schema.tag` fills it in, so you write `new InvalidBlock({ reason: "overlap" })`.
- The fields are the wire fields, with the same names and types as today.
- A field may not be called `name`, `message`, `stack` or `cause`: `Error` owns those. When the wire needs one of those names, give the class a `wire()` method. `NameTaken` in `planner/errors.ts` is the one case today.
- Each module keeps its errors in `<module>/errors.ts` with a union type (`PlannerFailure`). Its test asserts `SameWire<PlannerFailure, PlannerError>` against the old plain union, so a changed kind or field fails typecheck.
- Recover with `Effect.catchTag("InvalidBlock", ...)` or `Effect.catchTags`. Convert a foreign error at the boundary with `Effect.mapError`.

## Services and Layers

Every external dependency is a `Context.Service` with one live Layer and one test Layer. Logic asks for the service; only the edge provides it.

```ts
export class Oura extends Context.Service<
  Oura,
  { sleepSince(day: string): Effect.Effect<ReadonlyArray<typeof SleepDay.Type>, OuraError> }
>()("lifeos/health/Oura") {
  static readonly layerNoDeps = Layer.effect(Oura, Effect.gen(function* () { ... return Oura.of({ sleepSince }); }));
  static readonly layer = Oura.layerNoDeps.pipe(Layer.provide(FetchHttpClient.layer));
  static readonly layerTest = (days: ReadonlyArray<typeof SleepDay.Type>) => Layer.succeed(Oura, Oura.of({ ... }));
}
```

- The identifier is `lifeos/<module>/<Service>`. Layers are static members named `layer`, `layerTest` and, when the live one has its own dependencies, `layerNoDeps`.
- Get a service with `yield* Oura` inside a generator. Use `Oura.use(...)` only for a one-line helper.
- Secrets are `Redacted`. Read Convex `env` when you build the Layer, never inside logic.
- HTTP goes through `HttpClient` from `effect/http` with `FetchHttpClient.layer`, so a test can swap the transport.

| Dependency | Service | Home | Live Layer | Test Layer |
| --- | --- | --- | --- | --- |
| Convex ctx for reads | `Reads` | `convex/platform/effect.ts` | given by every builder | `runIn(t, effect)` on convex-test |
| Convex ctx for unrecorded writes | `Writes` | same | `ownerMutation`, `workerMutation`, internal mutations | same |
| Convex action ctx | `Acts` | same | action builders | same |
| Change recorder | `Recorder` | same | `changeMutation` | same, with the real recorder |
| Who is acting | `CurrentActor`, `CurrentWorker` | same | builders | `Effect.provideService` |
| Clock | `Clock` from `effect` | built in | default | `TestClock` in `it.effect` |
| AI router and providers | `AiRouter`, `AiProvider` | `convex/ai/` | AI SDK providers | scripted model |
| Secrets | `Secrets` | `convex/platform/secrets.ts` | secrets table | fixed map |
| Oura | `Oura`, `OuraToken` | `convex/health/` | `FetchHttpClient` | canned nights |
| Places | `Places` | `convex/places/` | OSM providers | canned places and trips |
| Notes Relay token | `RelayToken` | `convex/notes/relay.ts` | signs with the relay secret | fixed token |
| Things source | `ThingsSource` | `apps/things-sync/src/things.ts` | reads the Things database | fixture rows |
| Convex from a client | `Backend` | `shared/client/` | the app's Convex client | scripted answers |
| Saved preferences | `KeyValueStore` from `effect/persistence` | per app | `localStorage`, `expo-sqlite/kv-store` | `layerMemory` |

A change handler may ask for `Reads`, `Recorder` and `CurrentActor`, and not for `Writes`. So the type system now enforces the old rule: a public change can only write through the recorder.

## Convex functions

Build public functions with the Effect builders. They wrap the owner guard in `convex/platform/access.ts`, which stays the only file that touches the raw `query`, `mutation` and `action` builders.

```ts
export const rename = changeMutation({
  action: "area.rename",
  args: { areaId: v.id("areas"), title: v.string() },
  handler: Effect.fn("areas.rename")(function* ({ areaId, title }) {
    const named = yield* Effect.fromResult(parseTitle(title));
    const area = yield* loadArea(areaId);
    return { changed: yield* recording((record) => record.patch("areas", area._id, { title: named })) };
  }),
});
```

- Import the builders from `convex/platform/effect.ts`. Each handler takes the args (agent mutations also get `run` and `caller`) and returns an Effect with no error channel, except `changeMutation`. What each may ask for: `ownerQuery`, `agentQuery`, `internalQuery`: `Reads`. `changeMutation`: `Reads | Recorder | CurrentActor`. `ownerMutation`: `Reads | Writes | CurrentActor`. `workerMutation`: `Reads | Writes | CurrentWorker`. `agentMutation`, `internalMutation`: `Reads | Writes`. `ownerAction`, `internalAction`: `Acts`. `workerAction`: `Acts | CurrentWorker`. The internal builders keep an optional `returns` validator.
- `reading((ctx) => ...)`, `writing(...)`, `acting(...)` and `recording((record) => ...)` turn a Convex promise into an Effect. A rejection there is a defect: Convex errors such as `ConvexError` leave the function unchanged.
- `changeMutation` records Activity, adds `activityId` to the value and refuses a change that failed after it wrote, exactly as before.
- A query or an unrecorded mutation that returns a Result wraps its program in `asWire(...)`.
- Queries and mutations run on a synchronous scheduler, because Convex forbids timers there. Do not use `Effect.sleep`, `Effect.timeout`, `Schedule` or `Effect.forkDetach` in a query or a mutation. They are fine in actions.
- One Convex function is one fibre and one transaction. Do not fork inside a mutation.
- Never change an `args` or `returns` validator, a file path under `convex/` or an exported function name while the migration runs: installed apps call them by name.

## Schema and the Convex schema

The Convex schema stays the single source of truth for stored documents and function arguments. `tables.ts` validators define `Doc`, `Id` and the `v` validators that Convex checks on the wire. Do not redeclare a table as an Effect Schema.

Effect Schema is for what Convex cannot check:

- tagged errors;
- data from outside: HTTP responses (Oura, OSM, AI providers), Things rows, relay tokens, JSON read from `localStorage` or SQLite, deep links;
- domain primitives parsed from text, such as an ISO date or an estimate.

Decode at the boundary and pass typed values inward. Do not hand-write `typeof` checks, `JSON.parse(...) as T` or `isRecord` helpers.

```ts
const SleepPage = Schema.Struct({ data: Schema.Array(SleepDay) });
const page = yield* HttpClientResponse.schemaBodyJson(SleepPage)(response).pipe(
  Effect.mapError(() => new OuraInvalidResponse()),
);
```

When a Schema must mention a document, use the type from `Doc<"tasks">`, not a second declaration.

## Results across the Convex boundary

A class instance does not survive Convex's JSON transport, so a refusal crosses as plain JSON:

```ts
{ ok: true, value: { taskId, activityId } }
{ ok: false, error: { kind: "invalid_block", reason: "overlap" } }
```

This format is permanent. It is what `serialise` produced, so every installed app reads it without change.

- Server: `changeMutation` encodes for you. Elsewhere use `asWire(effect)` or `resultToWire(result)`. `wireError` drops `_tag` and keeps `kind` and the fields.
- Client: `wireToEffect(wire)` puts the refusal back in the error channel as plain `{ kind, ... }` data. Error classes stay on the server. `wireToResult` gives a `Result` and drops a `_tag` if one ever leaked.
- `Wire<E>` is the wire type of an error union. Function return types are inferred from it, so the apps see the same types as before.

## Client state: Atom

Atoms from `effect/reactivity` hold client state on web and iPhone. `@effect/atom-react` gives the hooks, and works in React Native because it only needs React.

- State a hand-rolled `useSyncExternalStore` store holds today becomes an atom: `Atom.make(initial)` for a value, `Atom.make((get) => ...)` for a derived value, `Atom.writable(read, write)` for a write with logic.
- Each app has one registry in `src/lib/atoms.ts`, made with `AtomRegistry.make({ scheduleTask })` and given to React with `RegistryContext.Provider`. Code outside React (key handlers, commands) reads and writes through that registry.
- Work that needs a service runs through an atom runtime: `Atom.runtime(Backend.layer(...))`, then `runtime.fn<Args>()(...)` for a mutation and `runtime.atom(...)` for an async value. The component reads an `AsyncResult`.
- A saved preference is `Atom.kvs` over a `KeyValueStore` Layer, with a Schema for the stored value.
- Server data stays on Convex's `useQuery` and the saved views. Do not copy query results into atoms.
- Give an atom that must outlive its readers `Atom.keepAlive`.

```tsx
export const SelectRow = ({ taskKey, title }: { taskKey: string; title: string }) => {
  const selected = useAtomValue(toggleSelectedAtom, (keys) => keys.has(taskKey));
  const toggle = useAtomSet(toggleSelectedAtom);
  return <button type="button" aria-pressed={selected} onClick={() => toggle(taskKey)}>{title}</button>;
};
```

## Tests

- Convex behaviour: convex-test and plain `vitest`, calling public functions through `api`, as before. These tests are the wire contract. Do not weaken an assertion on a returned value to make a migration pass.
- Effect logic and services: `@effect/vitest`. `it.effect` gives a `TestClock`; `layer(SomeService.layerTest(...))("name", (scoped) => { scoped.effect(...) })` shares one Layer across a block; `it.live` uses the real clock.
- Assert a refusal through the wire (`expect(yield* asWire(program)).toStrictEqual({ ok: false, error: { kind: ... } })`) or with `Effect.flip`.
- Each live Layer for an HTTP service has one test that swaps `HttpClient.HttpClient` for canned responses. Existing MSW tests keep working, because the live Layer still calls `fetch`.

## During the migration

Old and new code live side by side until the final slice. These pieces join them; the final slice deletes them.

- **Twins.** A frozen export that returns a neverthrow `Result` keeps its name and signature. Its logic moves to an Effect named with `Fx` in the same file (`undoActivity` and `undoActivityFx`), and the old name becomes one line over the twin.
- **`legacyRead(ctx, effect)`, `legacyWrite(ctx, effect)` and `legacyChange(ctx, record, effect)`** in `convex/platform/effect.ts` run a twin for an old caller. They provide `Reads`, `Reads | Writes` or `Reads | Recorder`, and return a neverthrow `Result` whose error is the plain wire error (`wireError`, so no `_tag`).
- **The bridge** in `shared/effect/bridge.ts`: `toNeverthrow(result)` turns an Effect `Result` into a neverthrow one with the wire error, for pure twins (`parseIsoDate` in `shared/date.ts`). `fromNeverthrow(result)` goes the other way. `effectFromNeverthrow(() => old(...))` calls another slice's old function from Effect code when its twin is not on main yet; the thunk may return a `Result`, a promise of one or a `ResultAsync`, and a throw stays a defect.
- **`changeAs` and `readAsOwner`** accept functions from either builder. Agent tools in Effect code use `changeAsFx(actor, registered, args)` and `readAsOwnerFx(registered, args)`.
- **`runChange(ctx, actor, action, effect)`** runs a change in process, as an Effect: one Activity for `actor`, `activityId` added to the value, and the refused-after-write rule.
- **`runIn(t, effect)`** in `convex/backend.test-utils.ts` runs an Effect inside `t.run` with `Reads` and `Writes`. A failure rejects with the error itself.
- **Shared parsers** live in `shared/effect/date.ts`, `estimate.ts` and `recurrence.ts` with the same names. Import those in new code.

## Where `Effect.run*` is allowed

Effects are run only at an edge:

- `packages/backend/convex/platform/effect.ts`: the builders and `runAtEdge`;
- `apps/web/src/lib/runtime.ts` and `apps/mobile/src/lib/runtime.ts`: one `ManagedRuntime` per app;
- `apps/things-sync/src/main.ts` and `apps/relay/src/index.ts`: the process or Worker entry;
- tests, through `@effect/vitest` or `runIn`.

Everywhere else, return the Effect.

## Choices

1. **Effect 4.1.7, not 3.** Atom and its React binding ship with it (`effect/reactivity`, `@effect/atom-react`), so nothing needs a v3-only package.
2. **A thin Convex adapter, not Confect.** `@confect/server` 10.6 supports Effect 4.1, but it replaces the Convex schema with its own, adds a codegen step and rewrites every function spec. That would move the single source of truth and put the wire format at risk. The adapter is about 150 lines over the existing owner guard.
3. **The Convex schema stays the source of truth.** Effect Schema covers errors and outside data only.
4. **The wire format does not change, ever.** `_tag` is internal; `kind` is the contract.
5. **Server data stays on Convex's reactive queries.** Atoms hold client state and run client effects.
6. **The AI SDK and `@convex-dev/agent` stay,** wrapped in `AiRouter` and `AiProvider`. `effect/ai` is a later option.
7. **No Effect MCP server.** Effect's own guidance is the docs bundled in the package. The official `effect-ts` skill is installed and points there.
8. **`@effect/language-service` as an editor plugin only.** Its command-line diagnostics fail on TypeScript 6 in this repo. `@effect/tsgo` needs TypeScript 7; revisit when the repo moves.
