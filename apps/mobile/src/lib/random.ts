import { getRandomValues } from "expo-crypto";

export const addMissingRandomValues = () => {
  const scope = globalThis as { crypto?: { getRandomValues?: unknown } };
  if (scope.crypto?.getRandomValues) return;
  Object.defineProperty(globalThis, "crypto", { value: { ...scope.crypto, getRandomValues }, configurable: true, writable: true });
};
