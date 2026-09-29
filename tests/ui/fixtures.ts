import { test as base, type Page } from "@playwright/test";
import type { TaskRow } from "../../apps/web/lib/api";
export const day = "2026-09-29";
export function task(
  id: string,
  title: string,
  scheduledDate: string | null = day,
): TaskRow {
  return {
    id,
    title,
    userId: "synthetic-owner",
    areaId: "general",
    revision: 1,
    status: "todo",
    priority: "medium",
    energyLevel: "medium",
    dueDate: null,
    scheduledDate,
    sprintId: null,
    sortOrder: 0,
    idleFlagged: false,
    createdAt: `${day}T08:00:00Z`,
    updatedAt: `${day}T08:00:00Z`,
    completedAt: null,
    estimatedMinutes: 25,
    _subtasks: [],
  };
}
export type Model = {
  tasks: TaskRow[];
  failCapture: boolean;
  requests: string[];
  focus: unknown;
};
export async function mockApi(page: Page, model: Model) {
  await page.clock.setFixedTime(new Date(`${day}T10:00:00Z`));
  await page.route("https://**/*", (route) => route.abort());
  await page.route("**/api/**", async (route) => {
    const req = route.request(),
      u = new URL(req.url()),
      p = u.pathname,
      method = req.method();
    model.requests.push(`${method} ${p}`);
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, json: body });
    const body = () => req.postDataJSON();
    if (p === "/api/daily/preferences")
      return json({ timezone: "Africa/Lagos" });
    if (p === "/api/daily/focus") {
      if (method === "PUT") model.focus = body();
      return json({ focus: model.focus });
    }
    if (p === "/api/tasks/today")
      return json({
        tasks: model.tasks.filter(
          (t) => t.scheduledDate === day && t.status !== "done",
        ),
        date: day,
        doneTodayCount: model.tasks.filter((t) => t.status === "done").length,
        dailyCapacity: 240,
        usedMinutes: 0,
      });
    if (p === "/api/tasks") return json({ tasks: model.tasks });
    if (p === "/api/backlog")
      return json({
        tasks: model.tasks.filter(
          (t) => !t.scheduledDate && t.status !== "done",
        ),
      });
    if (p === "/api/areas")
      return json({
        areas: [
          {
            id: "general",
            name: "General",
            color: "#01696f",
            systemKey: "general",
          },
        ],
      });
    if (p === "/api/sprints") return json({ sprints: [] });
    if (p === "/api/tags") return json({ tags: [] });
    if (p === "/api/goals") return json({ goals: [] });
    if (p === "/api/priorities")
      return json({
        period: { week: "2026-09-28", month: "2026-09-01" },
        week_anchors: [],
        month_anchors: [],
      });
    if (p === "/api/ai/config")
      return json({ enabled: false, provider: null, model: null });
    if (p === "/api/time-logs/active") return json({ log: null });
    if (p === "/api/time-logs") return json({ logs: [] });
    if (p === "/api/time-logs/summary/week") return json({ summary: [] });
    if (p === "/api/events/user")
      return route.fulfill({
        contentType: "text/event-stream",
        body: ": synthetic test\n\n",
      });
    if (p === "/api/reviews/current") return json({ review: null });
    if (p === "/api/reviews") return json({ reviews: [] });
    if (p === "/api/accomplishments") return json({ accomplishments: [] });
    if (p === "/api/sync/google/status") return json({ connected: false });
    if (p === "/api/insights/activity")
      return json({ days: [], streak: 0, totalCompleted: 0 });
    if (p === "/api/daily/capture") {
      if (model.failCapture)
        return json({ error: "Synthetic temporary save failure" }, 503);
      const made = body().items.map(
        (item: { title: string; scheduledDate?: string }) =>
          task(crypto.randomUUID(), item.title, item.scheduledDate ?? null),
      );
      model.tasks.push(...made);
      return json({ tasks: made, created: made.length });
    }
    if (p === "/api/daily/move") {
      const b = body();
      for (const target of b.targets) {
        const t = model.tasks.find((t) => t.id === target.targetId);
        if (t) {
          t.scheduledDate = b.scheduledDate;
          t.revision++;
        }
      }
      return json({ updated: b.targets.length, targets: b.targets });
    }
    const id = p.match(/^\/api\/tasks\/([^/]+)$/)?.[1];
    if (id) {
      const t = model.tasks.find((t) => t.id === id);
      if (!t) return json({ error: "Not found" }, 404);
      if (method === "PATCH")
        Object.assign(t, body(), { revision: t.revision + 1 });
      return json({ task: t, subtasks: t._subtasks, subtaskProgress: null });
    }
    return json({ error: `Unmocked synthetic endpoint: ${method} ${p}` }, 501);
  });
}
export const test = base.extend<{ model: Model }>({
  model: async ({ page }, use) => {
    const model: Model = {
      tasks: [
        task("one", "Review the home-server backup"),
        task("two", "Practise Python for 25 minutes"),
        task("inbox", "Renew domain reminder", null),
      ],
      failCapture: false,
      requests: [],
      focus: null,
    };
    await mockApi(page, model);
    await use(model);
  },
});
export { expect } from "@playwright/test";
