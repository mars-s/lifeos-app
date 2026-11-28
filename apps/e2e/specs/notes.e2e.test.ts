import { expect, test } from "../src/app.fixture.ts";

test("the mode switch goes to Notes and back to the Planner", async ({ app, page }) => {
  await app.go("/today");
  await app.openSidebar();
  await page.locator("[data-mode-switch]").getByRole("button", { name: "Notes" }).click();
  await app.openSidebar();
  await expect(page.locator("nav[data-sidebar-mode=notes]")).toBeVisible();
  await page.locator("[data-mode-switch]").getByRole("button", { name: "Planner" }).click();
  await expect(page.locator("nav[data-sidebar-mode=planner]")).toBeVisible();
});

test("a new note takes typing, and its title shows in the list", async ({ app, page }) => {
  await app.go("/notes");
  await app.openSidebar();
  await page.locator("nav[data-sidebar-mode=notes]").getByRole("button", { name: "New note" }).click();
  const editor = page.locator(".cm-content");
  await expect(editor).toBeVisible();
  const title = app.uniq("Swarm note");
  await editor.click();
  await page.keyboard.type(`# ${title}\n\nA line typed by the swarm with **bold** and $x^2$.`);
  await expect(editor).toContainText("A line typed by the swarm");
  await app.openSidebar();
  await expect(page.locator("nav[data-sidebar-mode=notes]").getByText(title).first()).toBeVisible();
});

test("Cmd+J with AI off does not break the page", async ({ app, page }) => {
  await app.go("/today");
  await app.press("ControlOrMeta+j");
  await page.waitForTimeout(400);
  await page.keyboard.press("Escape");
  await expect(app.main).toBeVisible();
});
