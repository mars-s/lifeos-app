import { expect, test } from "../src/app.fixture.ts";

test("number keys move between the lists", async ({ app, page }) => {
  await app.go("/today");
  for (const [key, path] of [["1", "/inbox"], ["2", "/today"], ["3", "/upcoming"], ["4", "/anytime"], ["5", "/someday"], ["6", "/logbook"], ["7", "/trash"], ["8", "/planner"], ["2", "/today"]] as const) {
    await app.press(key);
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await app.ready();
  }
});

test("? opens the shortcut sheet and Cmd+, opens Settings", async ({ app, page }) => {
  await app.go("/today");
  await app.press("?");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toHaveCount(0);
  await app.press("ControlOrMeta+,");
  await expect(page).toHaveURL(/\/settings$/);
});

test("j and k walk the rows and Enter opens the card", async ({ app, page }) => {
  await app.go("/today");
  await app.press("j");
  await app.press("j");
  await app.press("k");
  await page.keyboard.press("Enter");
  await expect(app.main.locator("li[data-open-card]")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(app.main.locator("li[data-open-card]")).toHaveCount(0);
});
