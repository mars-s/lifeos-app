import { setupConvexAuth } from "@convex-dev/auth/server";
import { setupGithub } from "@convex-dev/auth/methods/github/server";
import { components, internal } from "./_generated/api";
import { env } from "./_generated/server";

const PUBLIC_WEB_ORIGIN = "https://lifeos.zephyrus.qzz.io";

const auth = setupConvexAuth({ component: components.auth });
export const { signOut, refreshSession, isAuthenticated } = auth;

export const { startSignInWithGithub, completeSignInWithGithub } = setupGithub(auth, {
  component: components.authGithub,
  allowedRedirectOrigins: [env.SITE_URL, env.CONVEX_SITE_URL, PUBLIC_WEB_ORIGIN],
}).attachUserCallbacks({
  createUser: internal.platform.access.createUser,
  onSignIn: internal.platform.access.onSignIn,
});
