import { AxeBuilder } from "@axe-core/playwright";
import { test as base, expect, type Page, type TestInfo } from "@playwright/test";
import { convexRun, readStack, RELAY_URL } from "./stack.ts";

type Session = { accessToken: string; refreshToken: string };

const SESSIONS_PER_CALL = 30;
const NARROW_PX = 768;

const IGNORED_CONSOLE = [/Download the React DevTools/, /\[vite\]/, /\[HMR\]/, /^Could not connect to the server\.$/];
const NO_RELAY = new URL(RELAY_URL).host;
const KNOWN_AXE = process.env.E2E_AXE_STRICT === "1" ? [] : ["color-contrast"];
const KNOWN_AXE_UNDER_OVERLAY = process.env.E2E_AXE_STRICT === "1" ? [] : ["aria-hidden-focus"];
const IGNORED_FAILURES = [/ERR_ABORTED/, /cancelled/i, /Load request cancelled/, /NS_BINDING_ABORTED/];
const BOUNDARY = /did not (load|open)/;

const WATCH_BOUNDARIES = `(() => {
  window.__boundaries = [];
  const look = () => {
    for (const alert of document.querySelectorAll('[role=alert]')) {
      const text = alert.textContent || '';
      if (/did not (load|open)/.test(text) && !window.__boundaries.includes(text)) window.__boundaries.push(text.slice(0, 200));
    }
  };
  new MutationObserver(look).observe(document, { subtree: true, childList: true });
})();`;

export const namespaceOf = (convexUrl: string) => convexUrl.replace(/[^a-zA-Z0-9]/g, "");

export class App {
  readonly page: Page;
  readonly info: TestInfo;

  constructor(page: Page, info: TestInfo) {
    this.page = page;
    this.info = info;
  }

  get narrow() {
    return (this.page.viewportSize()?.width ?? 1440) < NARROW_PX;
  }

  get main() {
    return this.page.locator("#main");
  }

  get sidebar() {
    return this.page.locator("nav[data-sidebar-mode]");
  }

  uniq(label: string) {
    return `${label} ${this.info.project.name} w${this.info.parallelIndex} ${Math.random().toString(36).slice(2, 7)}`;
  }

  async ready() {
    await expect(this.main).toBeVisible();
    await expect(this.page.locator('#main [role=status][aria-label="Loading…"]')).toHaveCount(0, { timeout: 15_000 });
  }

  async go(path: string) {
    await this.page.goto(path);
    await this.ready();
  }

  async openSidebar() {
    if (!this.narrow) return;
    const open = this.page.getByRole("button", { name: "Open the sidebar" });
    if ((await open.getAttribute("aria-expanded")) !== "true") await open.click();
    await expect(this.page.locator("aside").first()).toBeVisible();
  }

  async nav(name: string | RegExp) {
    await this.openSidebar();
    await this.sidebar.getByRole("link", { name: typeof name === "string" ? new RegExp(`^${name}`) : name }).first().click();
    await this.ready();
  }

  async press(key: string) {
    if (await this.page.evaluate(() => document.activeElement === document.body || document.activeElement === null)) await this.main.focus();
    await this.page.keyboard.press(key);
  }

  async capture(title: string) {
    await this.main.focus();
    await this.page.keyboard.press("q");
    const field = this.page.locator("input[name=capture]");
    await expect(field).toBeVisible();
    await field.fill(title);
    await field.press("Enter");
    await this.page.keyboard.press("Escape");
    return title;
  }

  async newTask(label: string) {
    await this.go("/inbox");
    const title = await this.capture(this.uniq(label));
    await expect(this.row(title)).toHaveCount(1);
    return title;
  }

  row(title: string) {
    return this.main.locator("li", { hasText: title }).first();
  }

  async openCard(title: string) {
    const row = this.row(title);
    await row.locator("[data-arrow-item]").first().dblclick();
    const card = this.main.locator("li[data-open-card]");
    await expect(card).toBeVisible();
    return card;
  }

  async undo() {
    await this.page.keyboard.press("ControlOrMeta+z");
  }

  async axe(label: string, overlay = false) {
    const result = await new AxeBuilder({ page: this.page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    const known = overlay ? [...KNOWN_AXE, ...KNOWN_AXE_UNDER_OVERLAY] : KNOWN_AXE;
    const serious = result.violations.filter((violation) => (violation.impact === "serious" || violation.impact === "critical") && !known.includes(violation.id));
    if (serious.length > 0)
      await this.info.attach(`axe ${label}`, { body: JSON.stringify(serious, null, 2), contentType: "application/json" });
    return serious.map((violation) => `${label}: ${violation.id} (${violation.impact}) ${violation.help} on ${violation.nodes.map((node) => node.target.join(" ")).slice(0, 3).join(", ")}`);
  }
}

export const test = base.extend<{ problems: string[]; app: App }, { session: () => Session }>({
  session: [
    async ({ playwright }, use) => {
      const { scratch } = readStack();
      if (!playwright) throw new Error("No Playwright");
      let left: Session[] = [];
      await use(() => {
        if (left.length === 0) left = JSON.parse(convexRun(scratch, "scratch:signInMany", { count: SESSIONS_PER_CALL })) as Session[];
        const next = left.pop();
        if (!next) throw new Error("No session left");
        return next;
      });
    },
    { scope: "worker" },
  ],
  storageState: async ({ session, baseURL }, use) => {
    const signedIn = session();
    const namespace = namespaceOf(readStack().convexUrl);
    await use({
      cookies: [],
      origins: [
        {
          origin: baseURL ?? "",
          localStorage: [
            { name: `__convexAuthJWT_${namespace}`, value: signedIn.accessToken },
            { name: `__convexAuthRefreshToken_${namespace}`, value: signedIn.refreshToken },
          ],
        },
      ],
    });
  },
  problems: [
    async ({ context }, use, testInfo) => {
      const problems: string[] = [];
      await context.addInitScript(WATCH_BOUNDARIES);
      const watch = (page: Page) => {
        page.on("console", (message) => {
          if (message.type() !== "error") return;
          if (IGNORED_CONSOLE.some((pattern) => pattern.test(message.text()))) return;
          if (message.text().includes(NO_RELAY) || message.location().url.includes(NO_RELAY)) return;
          problems.push(`console error: ${message.text().slice(0, 400)}`);
        });
        page.on("pageerror", (error) => {
          if (!error.message.includes(NO_RELAY)) problems.push(`uncaught: ${error.message.slice(0, 400)}`);
        });
        page.on("requestfailed", (request) => {
          const failure = request.failure()?.errorText ?? "";
          if (IGNORED_FAILURES.some((pattern) => pattern.test(failure)) || new URL(request.url()).host === NO_RELAY) return;
          problems.push(`request failed: ${request.method()} ${request.url().slice(0, 160)} ${failure}`);
        });
        page.on("response", (response) => {
          if (response.status() >= 400) problems.push(`HTTP ${response.status()}: ${response.request().method()} ${response.url().slice(0, 160)}`);
        });
      };
      context.pages().forEach(watch);
      context.on("page", watch);
      await use(problems);
      for (const page of context.pages()) {
        const seen = await page.evaluate(() => (window as unknown as { __boundaries?: string[] }).__boundaries ?? []).catch(() => []);
        for (const text of seen) if (BOUNDARY.test(text)) problems.push(`error boundary: ${text}`);
      }
      if (problems.length > 0) await testInfo.attach("problems", { body: problems.join("\n"), contentType: "text/plain" });
      if (testInfo.status === "passed") expect(problems, "console errors, uncaught exceptions, failed requests or error boundaries").toEqual([]);
    },
    { auto: true },
  ],
  app: async ({ page }, use, testInfo) => {
    await use(new App(page, testInfo));
  },
});

export { expect };
