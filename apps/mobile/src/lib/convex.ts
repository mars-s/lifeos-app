import type { TokenStorage } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import * as SecureStore from "expo-secure-store";

const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL;

export const convex = convexUrl ? new ConvexReactClient(convexUrl, { unsavedChangesWarning: false }) : null;

export const iphoneReturnUrl = convexUrl?.replace(/\.convex\.cloud\/?$/, ".convex.site/auth/iphone");

const secureKey = (key: string) => key.replace(/[^\w.-]/g, "_");

export const secureStorage = {
  getItem: (key) => SecureStore.getItemAsync(secureKey(key)),
  setItem: (key, value) => SecureStore.setItemAsync(secureKey(key), value),
  removeItem: (key) => SecureStore.deleteItemAsync(secureKey(key)),
} satisfies TokenStorage;
