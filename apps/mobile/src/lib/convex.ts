import type { TokenStorage } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import * as SecureStore from "expo-secure-store";

const devUrl = __DEV__ ? process.env.EXPO_PUBLIC_DEV_CONVEX_URL : undefined;
export const convexUrl = devUrl || process.env.EXPO_PUBLIC_CONVEX_URL;

export const convex = convexUrl ? new ConvexReactClient(convexUrl, { unsavedChangesWarning: false }) : null;

export const iphoneReturnUrl = convexUrl?.replace(/\.convex\.cloud\/?$/, ".convex.site/auth/iphone");

const secureKey = (key: string) => key.replace(/[^\w.-]/g, "_");

const devSession = devUrl && process.env.EXPO_PUBLIC_DEV_SESSION ? (JSON.parse(process.env.EXPO_PUBLIC_DEV_SESSION) as Record<string, string>) : null;

const devToken = (key: string) =>
  key.startsWith("__convexAuthJWT") ? devSession?.accessToken : key.startsWith("__convexAuthRefreshToken") ? devSession?.refreshToken : undefined;

export const secureStorage = {
  getItem: async (key) => (await SecureStore.getItemAsync(secureKey(key))) ?? devToken(key) ?? null,
  setItem: (key, value) => SecureStore.setItemAsync(secureKey(key), value),
  removeItem: (key) => SecureStore.deleteItemAsync(secureKey(key)),
} satisfies TokenStorage;
