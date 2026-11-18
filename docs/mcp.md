# MCP connector design note

LifeOS runs its remote MCP server inside the Convex deployment, using the [`@convex-dev/mcp`](https://www.convex.dev/components/mcp) component. There is no separate server and no separate auth provider for agents.

## What works today

- The component is installed in `packages/backend/convex/convex.config.ts`.
- `packages/backend/convex/mcp.ts` defines one read-only tool, `today`, behind the `lifeos:read` scope.
- `packages/backend/convex/http.ts` serves the MCP and OAuth discovery routes at the deployment's `.convex.site` origin.
- Every tool checks that the connection belongs to the owner (`LIFEOS_OWNER_USER_ID`, default `owner`). A key minted for any other user ID gets a tool error.
- `getUserId` returns the owner only for the owner's Convex Auth session (`platform/access:isOwner`). Anyone else gets `null`, so they cannot list connections, mint a key or approve a connection. See `docs/auth.md`.
- API keys work now, with no sign-in page. This path was tested against a local Convex backend: `tools/list`, a `today` call, a bad date, a missing key (HTTP 401) and a foreign user's key.

### Connect Claude Code (API key)

After `npx convex dev` has created the cloud deployment:

```sh
cd packages/backend
npx convex run mcp:createApiKeyForUser '{"userId":"owner","name":"claude-code"}'
claude mcp add --transport http lifeos https://<deployment>.convex.site/mcp \
  --header "Authorization: Bearer <apiKey>"
```

The key is shown once. Store it in your password manager, not in the repo.

## What is not built yet

Tracked in [#9](https://github.com/mars-s/lifeos-app/issues/9).

claude.ai custom connectors, and agents that use the device flow, need OAuth. OAuth needs two things Avi has to set up in a browser:

1. **A sign-in for the owner.** Done in #17: Convex Auth with GitHub, limited to the owner. Avi still has to create the GitHub OAuth app (`docs/auth.md`).
2. **A `/connect` consent page** in `apps/web`. It reads `api.mcp.getAuthRequest`, shows the client name and scopes, requires the user code for device-flow requests, and calls `api.mcp.authorize`. It must refuse to render inside a frame.

Deployment environment variables, set with `npx convex env set`:

| Variable | Value |
| --- | --- |
| `SITE_URL` | The web app origin, for example `https://lifeos.example.com`. Also where sign-in returns to |
| `MCP_CONSENT_URL` | `${SITE_URL}/connect` (optional, this is the default) |
| `LIFEOS_OWNER_GITHUB_ID` | The owner's numeric GitHub user id (see `docs/auth.md`) |
| `LIFEOS_OWNER_USER_ID` | Optional. Defaults to `owner` |

## Grok

Check what the Grok client supports when wiring it up. If it can send a custom `Authorization` header, an API key works today. If it can only paste a URL, it needs the device flow, which needs the consent page above.

## Writes

Tools stay read-only until the Things and Calendar sync exists. A write tool must queue a change for the Mac sync companion to apply to Things 3, then read it back. It must never treat the Convex mirror as the source of truth.
