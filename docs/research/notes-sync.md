# Notes sync: the merge library and the Cloudflare relay

Researched and measured on 26 and 27 November 2026 for [#82](https://github.com/mars-s/lifeos-app/issues/82). The Home Server is going offline. Notes stay local-first: the Mac app (Tauri), the iPhone app (Expo, Hermes) and the web app each keep a full copy and edit offline. A small relay on Cloudflare Durable Objects becomes the always-on peer and keeps the saved copy. Core keeps only the searchable copy of each note.

## The choice

**Yjs 13.6.** It is the only candidate that runs in the iPhone's Hermes engine without a native module, and the lightest by far (19 KB gzipped, against more than 1.1 MB of WebAssembly for Loro or Automerge). It is fast enough on every surface: a 50k-word note loads in under 4 ms and a keystroke costs 4 µs on the Mac, 29 µs in Hermes. It has the most used CodeMirror 6 binding, with shared undo and cursors, plus IndexedDB storage and a Durable Object server that Cloudflare maintains. Loro is faster to build documents and richer, but on the iPhone it needs a community native module, so it loses on the simpler, lighter rule.

## Candidates

| Library | Version (npm, 27 Nov 2026) | Core | Maintenance |
| --- | --- | --- | --- |
| [Yjs](https://github.com/yjs/yjs) | 13.6.33 (14.0 in beta) | Pure JavaScript | 23k stars, pushed 23 Nov 2026 |
| [Loro](https://github.com/loro-dev/loro) | `loro-crdt` 1.19.1 | Rust compiled to WebAssembly | 6.3k stars, pushed 25 Nov 2026 |
| [Automerge](https://github.com/automerge/automerge) | `@automerge/automerge` 3.5.0 | Rust compiled to WebAssembly | 6.8k stars, pushed 26 Nov 2026 |
| [json-joy](https://github.com/streamich/json-joy) | 18.30.0 | Pure JavaScript | 1.1k stars, one main author, pushed 8 Sep 2026 |

Also looked at and dropped: y-octo (Yjs rewritten in Rust; its JavaScript build is WebAssembly, so it has Loro's Hermes problem and gains nothing over Yjs here), Diamond Types (`diamond-types-web` last published May 2023) and Collabs (last published Sep 2023).

## The hard requirements

| Requirement | Yjs | Loro | Automerge | json-joy |
| --- | --- | --- | --- | --- |
| Runs in a Worker and Durable Object (tested with `wrangler dev`) | Yes. 60 KB gzipped | Yes, but only through its `bundler` entry: the default entry fails (`Invalid URL string`) and the base64 entry fails (`Wasm code generation disallowed by embedder`). 1,433 KB gzipped | Yes, through its `workerd` entry. 1,150 KB gzipped | Yes. 81 KB gzipped |
| Runs in Hermes (tested in the Hermes VM built from `facebook/hermes` main, 25 Nov 2026) | **Yes**, all benchmarks pass and converge | **No**: `Property 'WebAssembly' doesn't exist`. The native path is [`loro-react-native`](https://github.com/Leeeon233/loro-react-native) (uniffi, Loro FFI 1.17.1, 23 stars, 64 MB package) | **No**: same error. No maintained native path; the only one found is `react-native-automerge-generated` 0.1.0 | **No** on a 50k-word note: `Maximum call stack size exceeded` in its UTF-8 decoder (`String.fromCharCode.apply` on a 300k array). Fixable with a patch, not out of the box |
| Runs in the browser and the Tauri webview | Yes | Yes | Yes | Yes |
| CodeMirror 6 binding | `y-codemirror.next` 0.3.6 (Aug 2026): text, shared undo (`Y.UndoManager`), remote cursors | `loro-codemirror` 0.3.3 (Oct 2025) | `@automerge/automerge-codemirror` 0.2.0 (Apr 2026) | `@jsonjoy.com/collaborative-codemirror` |
| ProseMirror or Tiptap binding | `y-prosemirror` 1.3.7, Tiptap Collaboration 3.35 | `loro-prosemirror` 0.4.4 | `@automerge/prosemirror` 0.2.0 | Collaborative ProseMirror from the same author |
| Saves offline on web | `y-indexeddb` 9.0.12 | Write snapshots yourself | `automerge-repo` IndexedDB adapter (2.6 alpha) | Write snapshots yourself |
| Saves offline on iPhone | Updates and snapshots in `expo-sqlite`, the same scheme as the relay | Through the native module | Not possible without a native path | Not possible as it stands |

Hermes has no WebAssembly. The VM built for this test prints `undefined` for `typeof WebAssembly`, and the Hermes feature list does not mention it ([Features.md](https://github.com/facebook/hermes/blob/main/doc/Features.md)). A wasm-only library on the iPhone needs a JSI or native module, or it fails at import.

## The numbers

A 50k-word note (293,517 characters), written as 50,000 separate appends. Then 10,000 typed edits on it: single-character inserts and 10% backspaces, the cursor jumping every 50 keys, each edit its own transaction. Node 26.13 on Avi's MacBook. Sizes are minified with esbuild and gzipped at level 9.

| | Yjs 13.6.33 | Loro 1.19.1 | Automerge 3.5.0 | json-joy 18.30.0 |
| --- | --- | --- | --- | --- |
| Download, core (min+gzip) | **19 KB** | 14 KB JS + 1,408 KB wasm (980 KB brotli) | 6 KB JS + 1,137 KB wasm | 49 KB |
| Download with CodeMirror binding (CodeMirror itself excluded) | **33 KB** (with IndexedDB, sync and cursors) | 18 KB + 1,408 KB wasm | 18 KB + 1,137 KB wasm | not measured |
| Load the 50k-word note, fresh process | **0.7 ms** | 9.7 ms | 239 ms | 0.7 ms |
| Load it again, median of 7 | 0.12 ms | 1.0 ms | 163 ms | 0.08 ms |
| Load after the 10k edits | 3.6 ms | 5.2 ms | 202 ms | 3.9 ms |
| 10,000 typed edits | 41 ms (4.1 µs each) | 44 ms (4.4 µs) | 585 ms (58 µs) | **9.9 ms** (1.0 µs) |
| Apply those 10,000 updates on a second copy | 31 ms | 132 ms | 147 ms as one batch, **636 s** one at a time | **7.9 ms** |
| Saved note | 293,533 B | 271,732 B (136,027 B without history) | **75,390 B** | 293,550 B |
| Saved note after the edits | 335,834 B | 300,455 B | **93,923 B** | 310,844 B |
| One keystroke update | 26 B | 88 B | 128 B | **20 B** |
| Memory growth after loading the edited note (RSS) | **1.5 MB** | 7.6 MB | 90 MB | 2.4 MB |
| Building the note (50,000 appends) | 1,269 ms | 181 ms | 1,845 ms | **25 ms** |

**Yjs in Hermes**: building the note 682 ms, loading it 1 ms, 10,000 typed edits 292 ms (29 µs each), applying them on a second copy 156 ms, both copies equal.

What the numbers say:

- Automerge is too heavy for a phone: 90 MB of memory and 200 ms to open one long note, and it cannot run in Hermes. It has the smallest saved file.
- json-joy is the fastest in Node, but it fails in Hermes on a long note and has one main author.
- Loro and Yjs are both fast. Yjs wins on download size, memory and Hermes. Loro wins on building documents and on dropping history (`shallow-snapshot`).
- Timings move between runs by up to 3 times (the first run of Yjs edits took 119 ms). Every figure is far inside one frame per keystroke.

The scripts live outside the repo, posted in full [on #82](https://github.com/mars-s/lifeos-app/issues/82#issuecomment-7193252099) (`bench/adapters.mjs`, `bench/bench.mjs`, `bench/hermes-main.mjs`). To rerun them: `node --expose-gc bench.mjs <yjs|loro|automerge|jsonjoy> <build|load|loadrepeat|edits|loadafter>`. For Hermes: bundle `hermes-main.mjs` with esbuild (`--format=iife --define:LIB='"yjs"'`) and run it with the `hermes` binary.

## The relay

One Worker and one Durable Object class, `Note`, with one object per note (`idFromName(noteId)`). About 120 lines, posted [on #82](https://github.com/mars-s/lifeos-app/issues/82#issuecomment-7193252099) with its test. The proof ran locally with `wrangler dev` 4.168 and was never deployed.

- **Route.** `GET /notes/<noteId>` with `Upgrade: websocket`. The Worker checks the token, then hands the request to that note's object.
- **Websocket with hibernation.** The object accepts sockets with `ctx.acceptWebSocket`, so Cloudflare can evict it from memory while sockets stay open. On the next message the constructor runs again and loads the note from SQLite.
- **Protocol.** The standard Yjs sync protocol (`y-protocols/sync`): on connect each side sends its state vector (step 1) and gets back what it lacks (step 2), then live updates. Cursor and selection (awareness) messages pass through and are never stored.
- **Storage.** Durable Object SQLite, one table: `updates (id INTEGER PRIMARY KEY, data BLOB)`. Each incoming update is one row. There is no `AUTOINCREMENT`, which would write a second row to `sqlite_sequence` on every insert. At 200 rows the object writes one snapshot row and deletes the rest, in one `transactionSync`.
- **Devices are the source of truth.** Every device keeps a full copy, so an update lost by the relay is sent again in the next step 1 and step 2 exchange.

What the proof showed (12 of 12 checks passed):

1. A Mac client and an iPhone client typed at the same time and converged.
2. The iPhone went offline. Both kept typing. The iPhone came back, and both converged with every edit.
3. A third client, with both others gone, got the full note from the relay.
4. After `wrangler dev` was stopped and started again, a fresh client loaded the note from Durable Object SQLite. A note with 500 single-key updates came back intact after compaction.
5. A keystroke sent through the relay cost about 24 bytes on the wire.

### What the real relay adds

- **Batching.** Clients merge updates (`Y.mergeUpdates`) and send at most one every 500 ms while typing, so the relay writes about one row per half second of typing, not one per key.
- **Catch-up for every note.** A device keeps a full copy of every note, not only the open one. On launch and on reconnect it lists notes whose projection in Core changed since its last sync and calls `POST /notes/<noteId>/sync` with its state vector and pending update. The answer is what it lacks. Only the open note keeps a websocket.
- **Projection.** When a note goes quiet (a Durable Object alarm about 10 seconds after the last update), the relay sends Core the title, Area, entity references and a short excerpt through a `workerMutation`, with its own Worker token. Core then computes the embedding through the AI router. One writer, and it works even when only the iPhone edited.
- **Deleting a note.** Trashing it in Core tells the relay to `deleteAll()` that object's storage once the Trash is emptied.

## Auth

Convex Auth 2 signs its access tokens with the deployment's own key and publishes the public keys. The Worker verifies them with [`jose`](https://github.com/panva/jose), with no call to Convex.

- **JWKS**: `https://curious-pigeon-412.ap-southeast-2.convex.cloud/.well-known/jwks.json`. Fetched on 27 November 2026: one `EC` P-256 key, `alg: ES256`, `use: sig`. There is no `/.well-known/openid-configuration`, which `jose` does not need.
- **Claims** (from `@convex-dev/auth` 2.0.0, `dist/server/authProvider.js` and `dist/component/public.js`): `iss` is `${CONVEX_CLOUD_URL}/components/auth`, `aud` is `convex-auth`, `sub` is the session id (not the user id), and `exp` defaults to 60 seconds after issue (at most one hour).
- **Owner check.** The token says which session, not which person. That is enough because `onSignIn` refuses every GitHub account except the owner's, so the deployment only ever issues sessions to Avi (`docs/auth.md`). If another account can ever sign in, the relay must also ask Core (`platform/access:callerKind`) once per connection.
- **Sending the token.** Browsers cannot set headers on a websocket, so the client offers two subprotocols, `lifeos-notes` and the token. The Worker reads the token and answers with `lifeos-notes` only. This keeps the token out of URLs and logs.
- **Lifetime.** The token is checked when the socket opens. A socket stays open after the token expires, until the next reconnect. That is fine for one person; a stricter relay can close sockets older than an hour.

The proof served a local JWKS with the same shape, signed test tokens with a local ES256 key, and pointed `CONVEX_CLOUD_URL` at it. Accepted: a valid token. Refused with 401: no token, a token signed by another key, an expired token, a token for another audience, and a token from another issuer (such as `/components/mcp`). No real sign-in was used.

## Free plan fit

Cloudflare Workers Free, read on 27 November 2026 ([Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)):

| Limit (free) | Value | One person's notes |
| --- | --- | --- |
| Durable Objects | SQLite storage only, which the relay uses | Fits |
| Requests | 100,000 a day, shared with every Worker on the account. Incoming websocket messages count 20 to 1 | A heavy day: 4 hours of typing at 2 batches a second is about 29,000 messages, so about 1,500 requests, plus 3 devices catching up on up to 100 changed notes a few times a day (about 1,000) |
| Duration | 13,000 GB-s a day. Hibernating objects are not billed | Objects are only awake while handling messages. Far inside |
| Rows written | 100,000 a day | About 29,000 on that heavy day, plus compaction. The tightest limit, still inside. Batching is what keeps it there |
| Rows read | 5 million a day | A wake reads at most 200 rows |
| Storage | 5 GB per account, 1 GB per object, 8 MB per row | A 50k-word note is about 340 KB. 10,000 long notes is about 3.4 GB. A snapshot row passes 8 MB only past a million words |
| Worker size, startup | 64 MiB, 1 second | The relay is 286 KB (58 KB gzipped) |

When a free limit runs out, further calls fail until midnight UTC. Notes are local-first, so the apps keep working offline and catch up the next day. Workers Paid ($5 a month) lifts every limit above if it is ever needed.

## Risks

- **Hermes version.** The test used Hermes from `facebook/hermes` main, not the exact build inside React Native 0.88. The iPhone slice must run Yjs on the device first. Hermes has no `crypto` global, and Yjs uses `crypto.getRandomValues` for client ids, so the app needs a polyfill (`expo-crypto` or `react-native-get-random-values`).
- **Yjs 14.** It is in beta and changes the API. Pin 13.6 and move as one slice later, with the bindings.
- **No history.** With garbage collection on, Yjs keeps no version history. Deleted text leaves small tombstones: the note grew 14% after 10,000 edits. If Avi wants note history, keep dated snapshots in the relay.
- **iPhone editor in a webview.** CodeMirror runs in an Expo DOM component or a webview, as a local peer of the Y.Doc in Hermes. Obsidian's own mobile app is a webview, so the bar is reachable, but typing feel must be checked on the device.
- **Token lifetime.** A revoked session keeps its open socket until it reconnects (above).
- **One vendor.** The relay speaks the standard Yjs protocol and is about 120 lines, so it can move to another host. Cloudflare's own `y-partyserver` is the fallback if the hand-written relay grows.
- **Shared free requests.** Any other Worker on the same Cloudflare account eats the same 100,000 requests a day.
