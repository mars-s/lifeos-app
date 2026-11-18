#!/bin/sh
set -eu

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRATCH="${SCRATCH:-${TMPDIR:-/tmp}/lifeos-local-backend}"
OWNER_ID=1001

rm -rf "$SCRATCH"
mkdir -p "$SCRATCH"
cp -R "$ROOT/packages/backend/convex" "$ROOT/packages/backend/shared" "$ROOT/packages/backend/package.json" "$SCRATCH/"
ln -s "$ROOT/packages/backend/node_modules" "$SCRATCH/node_modules"

cat > "$SCRATCH/convex/scratch.ts" <<'SCRATCH_TS'
import { createFunctionHandle } from "convex/server";
import { components, internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { localIsoDate } from "../shared/date";
import { seedPlanner } from "./planner/seed.test-utils";

export const seed = internalMutation({
  args: {},
  handler: async (ctx) => {
    await seedPlanner(ctx, localIsoDate(new Date()), Date.now());
    return null;
  },
});

export const signIn = internalMutation({
  args: {},
  handler: async (ctx) =>
    ctx.runMutation(components.auth.public._internal_dangerous_signUp, {
      claims: { method: "github", profile: { id: "1001", login: "avi", emailVerified: false } },
      componentPath: "authGithub",
      createUserHandle: await createFunctionHandle(internal.platform.access.createUser),
      onSignInHandle: await createFunctionHandle(internal.platform.access.onSignIn),
      accessTokenTtlSeconds: 3600,
      refreshInactivityTimeoutSeconds: 86400,
      sessionMaxLifetimeSeconds: 86400,
    }),
});
SCRATCH_TS

cd "$SCRATCH"
export CONVEX_AGENT_MODE=anonymous
npx convex dev --once --typecheck disable >/dev/null 2>&1 || true
npx convex env set LIFEOS_OWNER_GITHUB_ID "$OWNER_ID" >/dev/null
npx convex env set SITE_URL "${BASE:-http://localhost:3990}" >/dev/null
npx convex env set AUTH_GITHUB_CLIENT_ID local >/dev/null
npx convex env set AUTH_GITHUB_CLIENT_SECRET local >/dev/null
npx convex dev --once --typecheck disable
npx convex run scratch:seed >/dev/null
npx convex run scratch:signIn > "$SCRATCH/session.json"
echo "Local backend is seeded. Session: $SCRATCH/session.json"
echo "Keep it running with: (cd $SCRATCH && CONVEX_AGENT_MODE=anonymous npx convex dev)"
