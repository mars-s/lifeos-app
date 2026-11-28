import { expect, test } from "../src/app.fixture.ts";

const LISTS = ["Inbox", "Today", "Upcoming", "Anytime", "Someday", "Logbook", "Trash"];

for (const title of LISTS)
  test(`${title} opens from the sidebar and by URL`, async ({ app, page }) => {
    await app.go("/today");
    if (title === "Upcoming") {
      await app.nav("Planner");
      await page.locator("#main [role=tablist]").getByRole("tab", { name: "Upcoming" }).click();
    } else await app.nav(title);
    await expect(page).toHaveURL(new RegExp(`/${title.toLowerCase()}$`));
    await expect(page).toHaveTitle(new RegExp(`^${title}`));
    await app.go(`/${title.toLowerCase()}`);
    await expect(page).toHaveTitle(new RegExp(`^${title}`));
  });

test("every Area and Project opens from the sidebar", async ({ app, page }) => {
  await app.go("/today");
  await app.openSidebar();
  const hrefs = await app.sidebar.locator('a[href^="/area?"], a[href^="/project?"]').evaluateAll((links) => [...new Set(links.map((link) => link.getAttribute("href") ?? ""))]);
  expect(hrefs.length).toBeGreaterThan(0);
  for (const href of hrefs) {
    await app.go(href);
    await expect(page.locator("#main h1").first()).toBeVisible();
    await expect(page.getByText("Nothing here")).toHaveCount(0);
  }
});

test("a route that does not exist says so", async ({ app, page }) => {
  await app.go("/area?id=nonsense");
  await expect(page.locator("#main")).toContainText(/Nothing here|did not/);
});
