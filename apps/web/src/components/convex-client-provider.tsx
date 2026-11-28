"use client";

import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { RegistryContext } from "@effect/atom-react";
import type { ReactNode } from "react";
import { useRouter } from "waku/router/client";
import { api } from "@lifeos/backend/api";
import { registry } from "@/lib/atoms";
import { convexClient as client } from "@/lib/runtime";
import { OwnerGate } from "./owner-gate";

export const isConvexConfigured = client !== null;

const publicPaths = new Set(["/design", "/design/notes", "/design/ai", "/design/widgets", "/design/canvas", "/design/genui", "/design/timeline", "/capture"]);

const Gated = ({ children }: { children: ReactNode }) => {
  const { path } = useRouter();
  return publicPaths.has(path) ? children : <OwnerGate>{children}</OwnerGate>;
};

const Signed = ({ children }: { children: ReactNode }) =>
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

export const ConvexClientProvider = ({ children }: { children: ReactNode }) => (
  <RegistryContext.Provider value={registry}>
    <Signed>{children}</Signed>
  </RegistryContext.Provider>
);
