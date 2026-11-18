"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import type { ReactNode } from "react";

const convexUrl = import.meta.env.WAKU_PUBLIC_CONVEX_URL;
const client = convexUrl ? new ConvexReactClient(convexUrl) : null;

export const isConvexConfigured = client !== null;

export const ConvexClientProvider = ({ children }: { children: ReactNode }) =>
  client ? <ConvexProvider client={client}>{children}</ConvexProvider> : children;
