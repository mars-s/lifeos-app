import { defineConfig, type Project } from "@playwright/test";

const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 4290);

const workersFrom = (value: string | undefined) => {
  const text = value?.trim() ?? "";
  if (/^\d+%$/.test(text)) return text;
  const count = Number(text);
  return Number.isInteger(count) && count > 0 ? count : "50%";
};

const ENGINES = ["chromium", "webkit"] as const;
const WIDTHS = {
  desktop: { viewport: { width: 1440, height: 900 }, hasTouch: false },
  iphone: { viewport: { width: 390, height: 844 }, hasTouch: true },
} as const;
const THEMES = ["light", "dark"] as const;

const projects = ENGINES.flatMap((engine) =>
  Object.entries(WIDTHS).flatMap(([width, device]) =>
    THEMES.map(
      (theme) =>
        ({
          name: `${engine}-${width}-${theme}`,
          use: { browserName: engine, ...device, colorScheme: theme, deviceScaleFactor: 1 },
        }) satisfies Project,
    ),
  ),
);

export default defineConfig({
  testDir: "specs",
  testMatch: "**/*.e2e.test.ts",
  outputDir: "out/results",
  globalSetup: "./src/global-setup.ts",
  fullyParallel: true,
  workers: workersFrom(process.env.E2E_WORKERS),
  retries: Number(process.env.E2E_RETRIES ?? 1),
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { outputFolder: "out/report", open: "never" }], ["json", { outputFile: "out/results.json" }]],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
    video: "on-first-retry",
    screenshot: "only-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: process.env.E2E_PROJECTS ? projects.filter((project) => process.env.E2E_PROJECTS?.split(",").some((name) => project.name.includes(name))) : projects,
});
