import { test, expect, task } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";
for (const theme of ["light", "dark"]) {
  test(`Today ${theme}: readable, accessible, and fits viewport`, async ({
    page,
    model,
  }, testInfo) => {
    await page.addInitScript(
      (value) => localStorage.setItem("devplanner-theme", value),
      theme,
    );
    await page.goto("/now");
    await expect(
      page.getByRole("button", {
        name: "Review the home-server backup",
        exact: true,
      }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    await testInfo.attach("axe", {
      body: JSON.stringify(result, null, 2),
      contentType: "application/json",
    });
    await page.screenshot({
      path: `docs/evidence/ui-${testInfo.project.name}-${theme}.png`,
      fullPage: true,
      animations: "disabled",
    });
    expect(result.violations).toEqual([]);
  });
}
test("capture, retain failed input, retry, then complete without planning", async ({
  page,
  model,
}) => {
  await page.goto("/now");
  await page
    .getByRole("button", { name: /add task/i })
    .first()
    .click();
  const input = page.getByRole("textbox", { name: /task/i }).first();
  await input.fill("Pay home internet bill");
  await page.getByLabel("Put it in").selectOption("today");
  model.failCapture = true;
  await input.press("Enter");
  await expect(
    page.getByText(/Synthetic temporary save failure/).first(),
  ).toBeVisible();
  await expect(input).toHaveValue("Pay home internet bill");
  model.failCapture = false;
  await input.press("Enter");
  await expect(input).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "Open details for Pay home internet bill",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect
    .poll(
      () =>
        model.tasks.find((t) => t.title === "Pay home internet bill")?.status,
    )
    .toBe("done");
  expect(
    model.tasks.filter((t) => t.title === "Pay home internet bill"),
  ).toHaveLength(1);
});
test("keyboard capture keeps draft across Escape and reload", async ({
  page,
  model,
}) => {
  await page.goto("/now");
  await page
    .getByRole("button", { name: /add task/i })
    .first()
    .click();
  const input = page.getByRole("textbox", { name: /task/i }).first();
  await input.fill("Remember after reload");
  await input.press("Escape");
  await page.reload();
  await page
    .getByRole("button", { name: /add task/i })
    .first()
    .click();
  await expect(input).toHaveValue("Remember after reload");
  await expect(input).toBeFocused();
});
test("busy day exposes remaining agenda and retains Inbox access", async ({
  page,
  model,
}) => {
  model.tasks.push(
    ...Array.from({ length: 9 }, (_, i) =>
      task(`extra${i}`, `Daily item ${i}`),
    ),
  );
  await page.goto("/now");
  await page.getByRole("button", { name: /show all.*tasks/i }).click();
  await expect(
    page.getByRole("button", { name: "Complete Daily item 8", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /pick from inbox/i }).click();
  await expect(
    page.getByText("Renew domain reminder", { exact: true }),
  ).toBeVisible();
});
for (const path of ["/backlog", "/review"]) {
  test(`${path} keyboard and contrast check`, async ({
    page,
    model,
  }, testInfo) => {
    await page.goto(path);
    await expect(page.getByRole("main")).toBeVisible();
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => {
        localStorage.setItem("devplanner-theme", value);
        window.dispatchEvent(new Event("devplanner-theme-change"));
      }, theme);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await page.locator("#ai-chat-toggle").evaluate(async (element) => {
        await Promise.all(
          element.getAnimations().map((animation) => animation.finished),
        );
      });
      const result = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
      await testInfo.attach(`axe-${theme}`, {
        body: JSON.stringify(result, null, 2),
        contentType: "application/json",
      });
      expect(result.violations).toEqual([]);
    }
  });
}
test("capture dialog keyboard focus and accessible controls", async ({
  page,
  model,
}) => {
  await page.goto("/now");
  await page
    .getByRole("button", { name: /add task/i })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: "Add task", exact: true });
  await expect(dialog).toBeVisible();
  const input = dialog.getByRole("textbox", { name: "Task", exact: true });
  await expect(input).toBeFocused();
  await input.press("Shift+Tab");
  await expect(
    dialog.getByRole("button", { name: "Close", exact: true }),
  ).toBeFocused();
  const result = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(result.violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /add task/i }).first(),
  ).toBeFocused();
});

test("mobile More menu opens and closes AI without a floating launcher", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile navigation only");
  await page.goto("/now");
  await page.getByRole("button", { name: "More options" }).click();
  await expect(page.getByRole("menuitem", { name: "Settings" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Ask AI" }).click();
  const assistant = page.getByRole("dialog", { name: "AI Assistant" });
  await expect(assistant).toBeVisible();
  await expect(page.locator("#ai-chat-toggle")).toBeHidden();
  await page.screenshot({
    path: "docs/evidence/ui-mobile-ai.png",
    fullPage: true,
    animations: "disabled",
  });
  await assistant.getByRole("button", { name: "Close assistant" }).click();
  await expect(assistant).toHaveCount(0);
});
