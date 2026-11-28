import { expect, test, type App } from "../src/app.fixture.ts";

const newTask = (app: App, label: string) => app.newTask(label);

test("a Task card edits the title and notes, and closes with Escape", async ({ app, page }) => {
  const title = await newTask(app, "Card task");
  const card = await app.openCard(title);
  const renamed = `${title} renamed`;
  const field = card.getByRole("textbox", { name: "Title" });
  await field.fill(renamed);
  await card.getByRole("textbox", { name: "Notes" }).click();
  await page.keyboard.type("A note written in the swarm.");
  await page.keyboard.press("Escape");
  await expect(app.main.locator("li[data-open-card]")).toHaveCount(0);
  await expect(app.row(renamed)).toBeVisible();
  await expect(app.row(renamed).getByRole("button", { name: /has notes/ })).toBeVisible();
  await page.waitForTimeout(500);
  await app.go("/inbox");
  const again = await app.openCard(renamed);
  await expect(again.getByRole("textbox", { name: "Notes" })).toHaveText(/A note written in the swarm/);
});

test("a Checklist item is added from the card", async ({ app, page }) => {
  const title = await newTask(app, "Checklist task");
  const card = await app.openCard(title);
  await card.locator("[data-card-tools]").getByRole("button", { name: "Checklist" }).click();
  await page.keyboard.type("First step");
  await page.keyboard.press("Enter");
  await expect(card.getByText("First step")).toBeVisible();
});

test("completing a Task moves it to the Logbook, and undo brings it back", async ({ app, page }) => {
  const title = await newTask(app, "Done task");
  await app.row(title).getByRole("checkbox").first().click();
  await expect(app.row(title)).toHaveCount(0);
  await page.waitForTimeout(1000);
  await app.go("/logbook");
  await expect(app.row(title)).toBeVisible();
  const reopen = await newTask(app, "Undo task");
  await app.row(reopen).getByRole("checkbox").first().click();
  await expect(app.row(reopen)).toHaveCount(0);
  await app.undo();
  await expect(app.row(reopen).getByRole("checkbox").first()).not.toBeChecked();
});

test("a Task moved to Anytime leaves the Inbox and shows in Anytime", async ({ app, page }) => {
  const title = await newTask(app, "Moving task");
  const card = await app.openCard(title);
  await card.locator("[data-card-when] button").first().click();
  await page.getByRole("dialog").or(page.getByRole("menu")).getByText(/^Anytime/).first().click();
  await page.keyboard.press("Escape");
  await expect(app.row(title)).toHaveCount(0);
  await app.go("/anytime");
  await expect(app.row(title)).toHaveCount(1);
});

test("a deleted Task goes to the Trash and can be put back", async ({ app, page }) => {
  const title = await newTask(app, "Trashed task");
  await app.row(title).locator("[data-arrow-item]").first().click();
  await page.keyboard.press("Backspace");
  await expect(app.row(title)).toHaveCount(0);
  await app.go("/trash");
  await expect(app.row(title)).toBeVisible();
  const back = await newTask(app, "Undone delete");
  await app.row(back).locator("[data-arrow-item]").first().click();
  await page.keyboard.press("Backspace");
  await expect(app.row(back)).toHaveCount(0);
  await app.undo();
  await expect(app.row(back)).toBeVisible();
});

test("every tool on the card opens and closes without an error", async ({ app, page }) => {
  const title = await newTask(app, "Tools task");
  const card = await app.openCard(title);
  const tools = card.locator("[data-card-tools] button:visible, [data-card-when] button:visible");
  const count = await tools.count();
  expect(count).toBeGreaterThan(3);
  for (let index = 0; index < count; index += 1) {
    const tool = tools.nth(index);
    const name = (await tool.getAttribute("aria-label")) ?? (await tool.innerText());
    if (/focus|ask ai|break into steps/i.test(name)) continue;
    await test.step(`tool ${name}`, async () => {
      await tool.click();
      await page.waitForTimeout(250);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(150);
      if ((await card.count()) === 0) await app.openCard(title);
    });
  }
  await expect(app.main.locator("li[data-open-card]")).toHaveCount(1);
});
