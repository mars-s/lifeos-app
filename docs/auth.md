# Sign-in and the owner guard

Only Avi can read or change his LifeOS. He signs in with GitHub through [Convex Auth](https://docs.convex.dev/auth/convex-auth) (version 2). Workers keep their own token. This page says how that is enforced and what Avi must set up once.

## How the guard works

Every public Convex function is built with one of three builders in `packages/backend/convex/platform/access.ts`:

| Builder | Who may call it | Used for |
| --- | --- | --- |
| `ownerQuery` | The owner, signed in | Every public query |
| `ownerMutation` | The owner, signed in, or an active Agent Run (its `agentRun` credential) | `undo`, `undoRun`, and `changeMutation`, which every change is built with |
| `workerMutation` | A registered Worker, by its token | `jobs.claim`, `heartbeat`, `complete`, `fail` and `things.sync` |

The owner check reads the caller's Convex Auth session, loads the `users` row it points at, and compares that row's GitHub id with `LIFEOS_OWNER_GITHUB_ID`. A failure is a `ConvexError` whose data is `{ kind, message }`:

- `signed_out`: "Sign in to use LifeOS."
- `not_owner`: "This is not your LifeOS. Only its owner can use it."

Sign-in itself is also gated. The `onSignIn` callback refuses any GitHub account other than the owner, so a stranger gets the `not_owner` message on the sign-in screen and no session or `users` row is created.

oxlint makes the guard hard to skip. Its `no-restricted-imports` rule rejects `query`, `mutation`, `action` and `httpAction` from `_generated/server`, and `queryGeneric` and friends from `convex/server`, everywhere except `platform/access.ts` and `http.ts`. Internal functions (`internalQuery`, `internalMutation`) are unaffected.

These public functions do not go through the builders, on purpose:

- Convex Auth's own functions in `convex/auth.ts` (`startSignInWithGithub`, `completeSignInWithGithub`, `refreshSession`, `signOut`, `isAuthenticated`). They must work before sign-in.
- The MCP component's functions in `convex/mcp.ts`. The component checks each call with `getUserId`, which returns the owner id only for the owner's Convex Auth session (it runs the internal query `platform/access:isOwner`).
- The `/auth/iphone` and `/auth/mac` HTTP routes in `convex/http.ts`. They read no data. Each redirects to `lifeos://auth` with the same query string, for the iPhone and packaged Mac sign-ins below.

## What Avi sets up once

The deployment already has `LIFEOS_OWNER_GITHUB_ID` (71009876, the id of `mars-s`) and `SITE_URL` (`http://localhost:3000`). `AUTH_GITHUB_CLIENT_ID` and `AUTH_GITHUB_CLIENT_SECRET` hold the placeholder `avi-must-set-this`, because the deployment refuses to start without them. Sign-in fails at GitHub until they are replaced.

1. Open <https://github.com/settings/applications/new> (Settings, Developer settings, OAuth Apps, New OAuth App).
2. Fill in the form:

   | Field | Value |
   | --- | --- |
   | Application name | `LifeOS` |
   | Homepage URL | `http://localhost:3000` |
   | Authorization callback URL | `https://curious-pigeon-412.ap-southeast-2.convex.site/oauth/github/callback` |
   | Enable Device Flow | Leave off |

   Convex Auth 2 serves the callback at `/oauth/github/callback`. The older `/api/auth/callback/github` path is from version 1 and does not work.
3. Click **Register application**, then **Generate a new client secret**.
4. In a terminal, set both values on the dev deployment:

   ```sh
   cd packages/backend
   npx convex env set AUTH_GITHUB_CLIENT_ID <the Client ID>
   npx convex env set AUTH_GITHUB_CLIENT_SECRET
   ```

   The second command has no value. The CLI asks for it, so the secret never lands in shell history or a chat. After copying the secret, `pbpaste | npx convex env set AUTH_GITHUB_CLIENT_SECRET` does the same.
5. Run `pnpm dev:web`, open <http://localhost:3000> and click **Sign in with GitHub**.

## How each app signs in

- **Web.** `apps/web/src/components/convex-client-provider.tsx` wraps the app in `ConvexAuthProvider`. `owner-gate.tsx` shows the signed-out screen until the session is live, and turns a `not_owner` error into a calm "Not your LifeOS" screen with Sign out. The design board at `/design` stays public, since it shows sample data only. The OAuth flow returns to the page it started on, so the origin must be listed in `SITE_URL`.
- **Mac (Tauri), development.** The window loads `http://localhost:3000`, so sign-in runs inside the webview exactly as on the web.
- **Mac, packaged build.** The bundle is served from `tauri://localhost`, and Convex Auth 2 only returns to `http` and `https` origins, so sign-in goes through the system browser. `owner-gate.tsx` starts the flow with `redirectTo` set to `https://<deployment>.convex.site/auth/mac`. Convex Auth then sets `window.location` to GitHub. The Mac app's navigation guard (`apps/desktop/src-tauri/src/lib.rs`) cancels any navigation away from the bundle and opens it in the default browser instead. When GitHub is done, the `/auth/mac` route bounces the browser to `lifeos://auth?convexAuthCode=...`. `tauri-plugin-deep-link` owns the `lifeos` scheme, the app brings its window forward, and the web app finishes with `signIn({ code })`. The code is useless without the `state` the webview kept in `localStorage`. There is nothing extra to set up: the GitHub callback stays `/oauth/github/callback`, and `CONVEX_SITE_URL` is already an allowed return origin. Development builds (`pnpm dev:desktop`) keep the in-webview flow, because macOS only routes deep links to a bundled app.
- **iPhone (Expo).** `apps/mobile/src/components/owner-gate.tsx` starts the flow with `redirectTo` set to `https://<deployment>.convex.site/auth/iphone`, opens it with `WebBrowser.openAuthSessionAsync`, and listens for `lifeos://auth`. The bounce route turns the return into that deep link, and the app finishes with `signIn({ code })`. The one-time code is useless without the `state` the app kept in SecureStore. Tokens live in SecureStore. This path typechecks and bundles but has not run on a device yet ([#29](https://github.com/mars-s/lifeos-app/issues/29)).

## Environment variables

| Variable | Value | Secret |
| --- | --- | --- |
| `LIFEOS_OWNER_GITHUB_ID` | The owner's numeric GitHub user id (`gh api user --jq .id`) | No |
| `SITE_URL` | The web app origin that sign-in may return to. `http://localhost:3000` in development | No |
| `AUTH_GITHUB_CLIENT_ID` | The GitHub OAuth app's Client ID | No |
| `AUTH_GITHUB_CLIENT_SECRET` | The GitHub OAuth app's client secret | Yes |

`convex.config.ts` declares all four, so a deploy fails if one is missing. Convex Auth 2 signs its tokens with the deployment's own key, so there is no `JWT_PRIVATE_KEY` or `JWKS` to manage.

A production deployment needs its own GitHub OAuth app (GitHub allows one callback URL per app), the production `SITE_URL`, and the same owner id.

## Tests

`packages/backend/convex/platform/access.test.ts` signs in through the real Convex Auth core (only the GitHub round trip is skipped) and checks that:

- signed out, a query, a change, and undo are refused with `signed_out`;
- a GitHub account that is not the owner cannot sign in;
- a session that is not the owner's is refused by a query, a change and undo;
- the owner can read, change and undo;
- the Things Worker and an Agent Run work with no signed-in identity, and a Worker without the `things` capability or with a forged token is refused;
- the MCP connector mints API keys and lists connections only for the owner.

`backend.test-utils.ts` gives every other test a backend signed in as the owner (`newBackend()`).
