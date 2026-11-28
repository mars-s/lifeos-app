import { expect, test } from "../src/app.fixture.ts";

test("the Planner shows the Brain Dump, the days and the Timebox", async ({ app, page }) => {
  await app.go("/planner");
  await expect(page).toHaveTitle(/^Planner/);
  if (app.narrow) {
    for (const pane of ["Brain Dump", "Days", "Timebox"]) {
      await page.getByRole("radio", { name: pane }).click();
      await page.waitForTimeout(200);
    }
  } else {
    await expect(page.locator("section[aria-label='Brain Dump']")).toBeVisible();
    await expect(page.locator("[data-plan-day]").first()).toBeVisible();
    await expect(page.locator("section[aria-label=Timebox]")).toBeVisible();
  }
});

test("the Planner and Upcoming tabs switch in place", async ({ app, page }) => {
  await app.go("/planner");
  const tabs = page.locator("#main [role=tablist]");
  await tabs.getByRole("tab", { name: "Upcoming" }).click();
  await expect(page).toHaveURL(/\/upcoming$/);
  await tabs.getByRole("tab", { name: "Planner" }).click();
  await expect(page).toHaveURL(/\/planner$/);
});

test("a Task added to the Brain Dump drags onto today, and undo puts it back", async ({ app, page }) => {
  test.skip(app.narrow, "the panes are tabs at iPhone width");
  await app.go("/planner");
  const title = app.uniq("Dragged task");
  const add = page.getByRole("textbox", { name: "Add a Task to the Brain Dump" });
  await add.fill(title);
  await add.press("Enter");
  await add.press("Escape");
  const dump = page.locator("[data-plan-list=inbox]");
  const row = dump.locator("[data-task-key]", { hasText: title }).first();
  await row.scrollIntoViewIfNeeded();
  await expect(row).toBeVisible();
  const today = page.locator('[data-plan-list^="day:"]').first();
  const from = await row.boundingBox();
  const to = await today.boundingBox();
  if (!from || !to) throw new Error("nothing to drag");
  await page.mouse.move(from.x + 40, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 52, from.y + from.height / 2, { steps: 3 });
  await page.mouse.move(to.x + to.width / 2, to.y + 40, { steps: 15 });
  await page.mouse.up();
  await expect(today.locator("[data-task-key]", { hasText: title })).toBeVisible();
  await app.undo();
  await expect(dump.locator("[data-task-key]", { hasText: title })).toBeVisible();
});

test("the Timebox switches between Day and Week and steps through dates", async ({ app, page }) => {
  await app.go("/planner");
  if (app.narrow) await page.getByRole("radio", { name: "Timebox" }).click();
  const timebox = page.locator("section[aria-label=Timebox]");
  for (const mode of ["Week", "Day"]) {
    const radio = page.getByRole("radio", { name: mode, exact: true });
    if ((await radio.count()) === 0) continue;
    await radio.first().click();
    await timebox.locator("button[aria-label^='Next ']").first().click();
    await timebox.locator("header").getByRole("button", { name: "Today", exact: true }).click();
  }
});
