import { expect, test, type App } from "../src/app.fixture.ts";

const ROUTES = ["/inbox", "/today", "/planner", "/upcoming", "/anytime", "/someday", "/logbook", "/trash", "/settings", "/notes"];
const MOST_BUTTONS = Number(process.env.E2E_CRAWL_BUTTONS ?? 80);

const LEAVE_ALONE =
  /delete|remove|empty|trash|sign out|log out|disconnect|forget|erase|reset|things|switch day|import|connect|allow|quit|archive|complete|reopen|mark|finish|stop|focus|pause|resume|keep all|spread|skip|save as template|discard|open system settings|copy|download|install|update/i;

const SHORTCUTS = ["?", "ControlOrMeta+k", "q", "ControlOrMeta+j"];

const labelOf = (app: App, index: number) =>
  app.page
    .locator("[data-crawl]")
    .nth(index)
    .evaluate((node) => (node.getAttribute("aria-label") ?? node.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 60));

const markButtons = (app: App) =>
  app.page.evaluate((most) => {
    for (const node of document.querySelectorAll("[data-crawl]")) node.removeAttribute("data-crawl");
    const buttons = [...document.querySelectorAll("#main button, #main [role=tab], #main [role=radio], #main [role=menuitem], aside button")]
      .filter((node) => node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0 && getComputedStyle(node).visibility !== "hidden" && !node.closest("[inert], [aria-hidden=true]") && !(node as HTMLButtonElement).disabled && node.getAttribute("role") !== "checkbox" && !node.closest("[role=checkbox]"))
      .slice(0, most);
    buttons.forEach((node, index) => node.setAttribute("data-crawl", String(index)));
    return buttons.length;
  }, MOST_BUTTONS);

const closeEverything = async (app: App) => {
  for (let tries = 0; tries < 3; tries += 1) {
    const open = await app.page.locator("[role=dialog]:visible, [role=menu]:visible, [cmdk-root], [data-radix-popper-content-wrapper], #main li[data-open-card]").count();
    if (open === 0) return;
    await app.page.keyboard.press("Escape");
    await app.page.waitForTimeout(120);
  }
};

for (const route of ROUTES)
  test(`crawl ${route}: every button, the shortcuts and accessibility`, async ({ app, page }) => {
    test.setTimeout(480_000);
    await app.go(route);
    await page.waitForTimeout(500);
    const violations = await app.axe(route);
    const total = await markButtons(app);
    const pressed: string[] = [];
    for (let index = 0; index < total; index += 1) {
      if (new URL(page.url()).pathname + new URL(page.url()).search !== route) await app.go(route);
      if ((await markButtons(app)) <= index) break;
      const label = await labelOf(app, index);
      if (LEAVE_ALONE.test(label)) continue;
      pressed.push(label);
      await test.step(`press ${label || index}`, async () => {
        await page.locator(`[data-crawl="${index}"]`).click({ timeout: 5000, trial: false }).catch(() => undefined);
        await page.waitForTimeout(250);
        if (await page.locator("[role=dialog]:visible, [role=menu]:visible").count()) {
          const opened = await app.axe(`${route} after ${label}`, true);
          violations.push(...opened);
        }
        await closeEverything(app);
      });
    }
    for (const key of SHORTCUTS) {
      await app.go(route);
      await test.step(`shortcut ${key}`, async () => {
        await app.press(key);
        await page.waitForTimeout(300);
        await closeEverything(app);
      });
    }
    await test.info().attach("pressed", { body: pressed.join("\n"), contentType: "text/plain" });
    expect(violations, "serious or critical accessibility violations").toEqual([]);
  });
