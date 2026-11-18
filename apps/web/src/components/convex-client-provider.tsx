"use client";

import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import type { ReactNode } from "react";
import { useRouter } from "waku/router/client";
import { api } from "@lifeos/backend/api";
import { OwnerGate } from "./owner-gate";

const convexUrl = import.meta.env.WAKU_PUBLIC_CONVEX_URL;
const client = convexUrl ? new ConvexReactClient(convexUrl) : null;

export const isConvexConfigured = client !== null;

const publicPaths = new Set(["/design"]);

const Gated = ({ children }: { children: ReactNode }) => {
  const { path } = useRouter();
  return publicPaths.has(path) ? children : <OwnerGate>{children}</OwnerGate>;
};

export const ConvexClientProvider = ({ children }: { children: ReactNode }) =>
  client ? (
    <ConvexAuthProvider
      client={client}
      api={{
        refreshSession: api.auth.refreshSession,
        signOut: api.auth.signOut,
        isAuthenticated: api.auth.isAuthenticated,
      }}
    >
      <Gated>{children}</Gated>
    </ConvexAuthProvider>
  ) : (
    children
  );
