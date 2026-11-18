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
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { localIsoDate } from "../shared/date";
import { activeSession } from "./planner/focus";
import { seedPlanner } from "./planner/seed.test-utils";
import { seedTimebox } from "./planner/planSeed.test-utils";
import { parseIsoDate } from "../shared/date";

const SEEDED = [
  "areas",
  "projects",
  "headings",
  "labels",
  "tasks",
  "checklistItems",
  "workBlocks",
  "focusSessions",
  "thingsSync",
  "activity",
  "activityChanges",
  "calendars",
  "externalCommitments",
  "calendarSync",
  "workingHours",
] as const;

export const seed = internalMutation({
  args: { today: v.optional(v.string()), timeZone: v.optional(v.string()) },
  handler: async (ctx, args) => {
    for (const table of SEEDED) for (const row of await ctx.db.query(table).collect()) await ctx.db.delete(table, row._id);
    const today = parseIsoDate(args.today ?? "").unwrapOr(localIsoDate(new Date()));
    await seedPlanner(ctx, today, Date.now());
    await seedTimebox(ctx, today, args.timeZone ?? "Australia/Sydney");
    return null;
  },
});

export const rewindFocus = internalMutation({
  args: { minutes: v.number() },
  handler: async (ctx, { minutes }) => {
    const session = await activeSession(ctx);
    if (session) await ctx.db.patch("focusSessions", session._id, { start: session.start - minutes * 60_000 });
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
SEED_ARGS="{\"today\":\"$(date +%F)\",\"timeZone\":\"$(node -e 'console.log(Intl.DateTimeFormat().resolvedOptions().timeZone)')\"}"
npx convex run scratch:seed "$SEED_ARGS" >/dev/null
npx convex run scratch:signIn > "$SCRATCH/session.json"
echo "Local backend is seeded. Session: $SCRATCH/session.json"
echo "Reseed with: (cd $SCRATCH && npx convex run scratch:seed '$SEED_ARGS')"
echo "Keep it running with: (cd $SCRATCH && CONVEX_AGENT_MODE=anonymous npx convex dev)"
