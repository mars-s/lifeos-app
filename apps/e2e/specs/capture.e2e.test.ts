import { expect, test } from "../src/app.fixture.ts";

test("Quick Capture files a thought in the Inbox, and undo takes it back", async ({ app }) => {
  await app.go("/inbox");
  const title = await app.capture(app.uniq("Captured thought"));
  await expect(app.row(title)).toBeVisible();
  await app.undo();
  await expect(app.row(title)).toHaveCount(0);
});

test("N adds a Task to the list with the focused row", async ({ app, page }) => {
  await app.go("/today");
  const title = app.uniq("New Today task");
  await app.main.locator("[data-task-key] [data-arrow-item]").first().focus();
  await page.keyboard.press("n");
  await expect(app.main.locator("li[data-open-card]")).toBeVisible();
  await page.keyboard.type(title);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(app.row(title)).toHaveCount(1);
  await app.mutationsReachedServer();
  await app.go("/today");
  await expect(app.row(title)).toHaveCount(1);
});
