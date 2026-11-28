import { expect, test } from "../src/app.fixture.ts";

const BAR = "[cmdk-root]";

for (const [typed, path] of [
  ["anyt", "/anytime"],
  ["upcoming", "/upcoming"],
  ["planner", "/planner"],
  ["logbook", "/logbook"],
  ["settings", "/settings"],
] as const)
  test(`the command bar goes to ${path}`, async ({ app, page }) => {
    await app.go("/today");
    await app.main.focus();
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.locator(BAR)).toBeVisible();
    await page.keyboard.type(typed);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page.locator(BAR)).toHaveCount(0);
  });

test("the command bar finds a Task and closes with Escape", async ({ app, page }) => {
  await app.go("/inbox");
  const title = await app.capture(app.uniq("Findable"));
  await app.main.focus();
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type(title.split(" ").slice(0, 1).join(" "));
  await expect(page.locator(`${BAR} [cmdk-item]`).first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(BAR)).toHaveCount(0);
});
