import { defineConfig } from "@playwright/test";

process.env.E2E_STACK ??= "perf";
process.env.E2E_WEB_PORT ??= "4390";
process.env.E2E_CONVEX_PORT ??= "3710";
process.env.E2E_BULK ??= "1";
process.env.E2E_PROFILING ??= "1";

const ENGINES = (process.env.E2E_ENGINES ?? "chromium,webkit").split(",");

export default defineConfig({
  testDir: "perf",
  testMatch: "**/*.perf.test.ts",
  outputDir: "out/perf/results",
  globalSetup: "./src/global-setup.ts",
  globalTeardown: "./perf/report.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 15 * 60_000,
  expect: { timeout: 30_000 },
  reporter: [["list"], ["html", { outputFolder: "out/perf/report", open: "never" }]],
  use: {
    baseURL: `http://localhost:${process.env.E2E_WEB_PORT}`,
    viewport: { width: 1440, height: 900 },
    colorScheme: "light",
    trace: "off",
    video: "off",
    actionTimeout: 30_000,
  },
  projects: ENGINES.map((engine) => ({ name: `${engine}-perf`, use: { browserName: engine as "chromium" | "webkit" } })),
});
