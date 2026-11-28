import { webkit, type FullConfig } from "@playwright/test";
import { startStack, stopStack } from "./stack.ts";

const WEBKIT_PROBE_MS = 20_000;

const probeWebKit = async () => {
  const browser = await webkit.launch();
  try {
    const opened = browser.newContext().then((context) => context.newPage());
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`WebKit did not open a page within ${WEBKIT_PROBE_MS / 1000} s. Its Networking process is stuck on this Mac, so every WebKit test would time out. Run E2E_PROJECTS=chromium, or set E2E_SKIP_WEBKIT_PROBE=1 to try anyway.`)), WEBKIT_PROBE_MS));
    await Promise.race([opened, timeout]);
  } finally {
    await browser.close().catch(() => undefined);
  }
};

export default async (config: FullConfig) => {
  if (process.env.E2E_SKIP_WEBKIT_PROBE !== "1" && config.projects.some((project) => project.use.browserName === "webkit")) await probeWebKit();
  const stack = await startStack();
  return async () => {
    if (process.env.E2E_KEEP !== "1" && process.env.E2E_REUSE !== "1") stopStack(stack);
  };
};
