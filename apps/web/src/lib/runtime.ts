"use client";

import { ConvexReactClient } from "convex/react";
import { Layer, ManagedRuntime } from "effect";
import { KeyValueStore } from "effect/persistence";
import { Atom } from "effect/reactivity";
import { Backend } from "@lifeos/backend/client/backend";

const convexUrl = import.meta.env.WAKU_PUBLIC_CONVEX_URL;

export const convexClient = convexUrl ? new ConvexReactClient(convexUrl) : null;

const send: Parameters<typeof Backend.layer>[0] = (mutation, args) =>
  convexClient ? convexClient.mutation(mutation, args) : Promise.reject(new Error("Convex is not configured"));

export const appLayer = Layer.mergeAll(Backend.layer(send), KeyValueStore.layerStorage(() => globalThis.localStorage));

export const runtime = ManagedRuntime.make(appLayer);

export const atomRuntime = Atom.runtime(appLayer);
