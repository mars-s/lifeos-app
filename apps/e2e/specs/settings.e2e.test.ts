import { expect, test } from "../src/app.fixture.ts";

test("Settings lists its sections and each Feature page opens", async ({ app, page }) => {
  await app.go("/settings");
  await expect(page.locator("#main h2").first()).toBeVisible();
  const features = await page.locator('#main a[href^="/settings/features/"]').evaluateAll((links) => [...new Set(links.map((link) => link.getAttribute("href") ?? ""))]);
  for (const href of features) {
    await app.go(href);
    await expect(page.locator("#main h1, #main h2").first()).toBeVisible();
  }
});

test("a Settings switch flips and undo flips it back", async ({ app, page }) => {
  await app.go("/settings");
  const toggle = page.locator("#main [role=switch]:not([inert] *)").first();
  const before = await toggle.getAttribute("aria-checked");
  await toggle.click();
  await expect(toggle).not.toHaveAttribute("aria-checked", before ?? "");
  await app.undo();
  await expect(toggle).toHaveAttribute("aria-checked", before ?? "");
});
