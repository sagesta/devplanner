import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test.beforeEach(async () => {
  if (!process.env.E2E_STORAGE_STATE)
    throw new Error(
      "E2E_STORAGE_STATE must point to a synthetic test account session outside the repository; see docs/USER-STEPS.md",
    );
});
test("Today has accessible navigation and usable capture in both themes", async ({
  page,
}) => {
  await page.goto("/now");
  await expect(page.getByRole("navigation").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: /add task/i }).first(),
  ).toBeVisible();
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(
      result.violations.filter(
        (v) => v.impact === "serious" || v.impact === "critical",
      ),
    ).toEqual([]);
    await expect(page).toHaveScreenshot(`today-${theme}.png`, {
      fullPage: true,
      animations: "disabled",
    });
  }
});
test("title-only capture and completion without weekly planning", async ({
  page,
}) => {
  await page.goto("/now");
  await page
    .getByRole("button", { name: /add task/i })
    .first()
    .click();
  const title = `Synthetic daily journey ${Date.now()}`;
  await page.getByRole("textbox", { name: /task/i }).first().fill(title);
  await page.getByLabel("Put it in").selectOption("today");
  await page.getByRole("textbox", { name: /task/i }).first().press("Enter");
  await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
  const all = page.getByRole("button", { name: /show all.*tasks/i });
  if (await all.isVisible()) await all.click();
  const complete = page.getByRole("button", {
    name: `Complete ${title}`,
    exact: true,
  });
  if (await complete.isVisible()) await complete.click();
  else {
    await expect(
      page.getByRole("button", {
        name: `Open details for ${title}`,
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Done", exact: true }).click();
  }
  await expect(complete).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: `Open details for ${title}`,
      exact: true,
    }),
  ).toHaveCount(0);
});
