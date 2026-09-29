import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  readFile,
  mkdtemp,
  mkdir,
  writeFile,
  copyFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pool, db } from "../db/client.js";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import { runMigrations } from "../db/migrate.js";
import { capture, move, setFocus, getFocus, DailyConflict } from "./daily.js";
import {
  buildSchedulePreview,
  applyScheduleProposals,
  getScheduleLearningSummary,
} from "./scheduler.js";
import { drainCalendarOutbox } from "./calendar-outbox.js";
const enabled = process.env.DAILY_INTEGRATION_TEST === "1";
after(async () => {
  await pool.end();
});
test(
  "daily persistence, revisions, stale scheduling and retry guarantees",
  { skip: !enabled },
  async () => {
    assert.match(
      process.env.DATABASE_URL ?? "",
      /daily_test/,
      "Use disposable daily_test database only",
    );
    await pool.query(
      "DROP SCHEMA public CASCADE; CREATE SCHEMA public; CREATE EXTENSION IF NOT EXISTS vector",
    );
    await pool.query(
      await readFile(
        new URL(
          "../db/migrations/0000_adorable_the_renegades.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    // Upgrade a legacy database containing existing data through the additive artifact.
    await pool.query(
      await readFile(
        new URL("../db/migrations/0007_daily_use.sql", import.meta.url),
        "utf8",
      ),
    );
    await runMigrations(pool);
    await runMigrations(pool);
    const user = (
      await pool.query(
        "INSERT INTO users(email,timezone) VALUES('test@example.invalid','Africa/Lagos') RETURNING id",
      )
    ).rows[0].id;
    const input = {
      idempotencyKey: "capture-test-1",
      items: [{ title: "one" }, { title: "two" }],
    };
    const [first, retry] = await Promise.all([
      capture(user, input),
      capture(user, input),
    ]);
    assert.deepEqual(first, retry);
    assert.equal(first.created, 2);
    assert.equal(
      (await pool.query("SELECT count(*) FROM areas WHERE user_id=$1", [user]))
        .rows[0].count,
      "1",
    );
    await assert.rejects(
      capture(user, { ...input, items: [{ title: "changed" }] }),
      DailyConflict,
    );
    await assert.rejects(
      capture(user, {
        idempotencyKey: "invalid-area",
        items: [
          { title: "must roll back" },
          { title: "invalid", areaId: "11111111-1111-4111-8111-111111111111" },
        ],
      }),
      DailyConflict,
    );
    assert.equal(
      (await pool.query("SELECT count(*) FROM tasks")).rows[0].count,
      "2",
    );
    const target = {
      targetType: "task" as const,
      targetId: first.tasks[0].id,
      expectedRevision: 1,
    };
    const moved = await move(user, {
      targets: [target],
      scheduledDate: "2026-09-28",
      idempotencyKey: "move-test-1",
    });
    assert.equal(moved.targets[0].expectedRevision, 2);
    await assert.rejects(
      move(user, {
        targets: [target],
        scheduledDate: "2026-09-29",
        idempotencyKey: "move-test-2",
      }),
      DailyConflict,
    );
    await setFocus(user, {
      date: "2026-09-28",
      targetType: "task",
      targetId: target.targetId,
    });
    assert.ok((await getFocus(user, "2026-09-28")).focus);
    const preview = await buildSchedulePreview(db, user, {
      fromDate: "2026-09-29",
      horizonEnd: "2026-10-01",
    });
    const apply = {
      previewId: preview.previewId,
      selectedIds: preview.proposals.map((p: any) => p.id),
      idempotencyKey: "apply-test-1",
    };
    assert.equal((await applyScheduleProposals(db, user, apply)).applied, 1);
    assert.equal((await applyScheduleProposals(db, user, apply)).applied, 1);
    assert.equal((await getFocus(user, "2026-09-28")).focus, null);
    const stale = await buildSchedulePreview(db, user, {
      fromDate: "2026-10-02",
      horizonEnd: "2026-10-03",
    });
    await pool.query("UPDATE tasks SET title=$1 WHERE id=$2", [
      "changed",
      target.targetId,
    ]);
    await assert.rejects(
      applyScheduleProposals(db, user, {
        previewId: stale.previewId,
        selectedIds: stale.proposals.map((p: any) => p.id),
        idempotencyKey: "stale-test-1",
      }),
      DailyConflict,
    );
    assert.equal(
      (
        await pool.query("SELECT scheduled_date::text FROM tasks WHERE id=$1", [
          target.targetId,
        ])
      ).rows[0].scheduled_date,
      "2026-09-29",
    );
    const other = (
      await pool.query(
        "INSERT INTO users(email) VALUES('other@example.invalid') RETURNING id",
      )
    ).rows[0].id;
    await assert.rejects(
      move(other, {
        targets: [{ ...target, expectedRevision: 4 }],
        scheduledDate: "2026-10-01",
        idempotencyKey: "cross-user-test",
      }),
      DailyConflict,
    );
    const capacityPreview = await buildSchedulePreview(db, user, {
      fromDate: "2026-10-02",
      horizonEnd: "2026-10-03",
    });
    await pool.query(
      "UPDATE users SET daily_capacity_minutes=100 WHERE id=$1",
      [user],
    );
    await assert.rejects(
      applyScheduleProposals(db, user, {
        previewId: capacityPreview.previewId,
        selectedIds: capacityPreview.proposals.map((p: any) => p.id),
        idempotencyKey: "capacity-test",
      }),
      DailyConflict,
    );
    const parent = first.tasks[1].id;
    const childRows = (
      await pool.query(
        "INSERT INTO subtasks(task_id,title,scheduled_date) VALUES($1,'move me','2026-09-29'),($1,'leave me','2026-09-29') RETURNING id",
        [parent],
      )
    ).rows;
    await move(user, {
      targets: [
        {
          targetType: "subtask",
          targetId: childRows[0].id,
          expectedRevision: 1,
        },
      ],
      scheduledDate: "2026-09-30",
      idempotencyKey: "child-move-1",
    });
    assert.equal(
      (
        await pool.query(
          "SELECT scheduled_date::text FROM subtasks WHERE id=$1",
          [childRows[1].id],
        )
      ).rows[0].scheduled_date,
      "2026-09-29",
    );
    assert.equal(
      (
        await pool.query("SELECT scheduled_date FROM tasks WHERE id=$1", [
          parent,
        ])
      ).rows[0].scheduled_date,
      null,
    );
    await assert.rejects(
      move(user, {
        targets: [
          {
            targetType: "subtask",
            targetId: childRows[1].id,
            expectedRevision: 1,
          },
          {
            targetType: "subtask",
            targetId: childRows[0].id,
            expectedRevision: 1,
          },
        ],
        scheduledDate: "2026-10-01",
        idempotencyKey: "batch-rollback",
      }),
      DailyConflict,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT scheduled_date::text FROM subtasks WHERE id=$1",
          [childRows[1].id],
        )
      ).rows[0].scheduled_date,
      "2026-09-29",
    );
    await pool.query(
      "INSERT INTO subtasks(task_id,title,completed,completed_at) VALUES($1,'s1',true,now()),($1,'s2',true,now())",
      [parent],
    );
    await pool.query(
      "INSERT INTO task_time_logs(task_id,started_at,ended_at) VALUES($1,now()-interval '10 minutes',now()),($1,now()-interval '20 minutes',now()),($1,now()-interval '30 minutes',now())",
      [parent],
    );
    assert.equal(
      (await getScheduleLearningSummary(db, user)).observedCompletionCount,
      2,
    );
    assert.ok(
      Number(
        (
          await pool.query(
            "SELECT count(*) FROM calendar_outbox WHERE delivered_at IS NULL",
          )
        ).rows[0].count,
      ) > 0,
    );
    const ids: string[] = [];
    await assert.rejects(
      drainCalendarOutbox(async (id) => {
        ids.push(id);
        throw new Error("Simulated Redis outage");
      }),
    );
    assert.ok(ids.length > 0);
    assert.equal(
      (
        await pool.query(
          "SELECT count(*) FROM calendar_outbox WHERE delivered_at IS NOT NULL",
        )
      ).rows[0].count,
      "0",
    );
    const retried: string[] = [];
    await drainCalendarOutbox(async (id) => {
      retried.push(id);
    });
    assert.equal(retried[0], ids[0]);
    assert.equal(
      (
        await pool.query(
          "SELECT count(*) FROM calendar_outbox WHERE delivered_at IS NULL",
        )
      ).rows[0].count,
      "0",
    );
  },
);

test(
  "clean Drizzle journal and repeated startup are compatible",
  { skip: !enabled || process.env.MUTATION_TEST === "1" },
  async () => {
    assert.match(process.env.DATABASE_URL ?? "", /daily_test/);
    await pool.query(
      "DROP SCHEMA public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public; CREATE EXTENSION IF NOT EXISTS vector",
    );
    await migrate(db, {
      migrationsFolder: fileURLToPath(
        new URL("../db/migrations", import.meta.url),
      ),
    });
    await runMigrations(pool);
    await runMigrations(pool);
    const columns = (
      await pool.query(
        "SELECT column_name FROM information_schema.columns WHERE table_name='subtasks' AND column_name IN ('scheduled_date','scheduled_time','revision')",
      )
    ).rows;
    assert.equal(columns.length, 3);
  },
);

test(
  "Drizzle upgrades populated legacy journal without changing task data",
  { skip: !enabled || process.env.MUTATION_TEST === "1" },
  async () => {
    assert.match(process.env.DATABASE_URL ?? "", /daily_test/);
    const folder = await mkdtemp(join(tmpdir(), "daily-legacy-"));
    try {
      await mkdir(join(folder, "meta"));
      const source = fileURLToPath(
        new URL("../db/migrations", import.meta.url),
      );
      const journal = JSON.parse(
        await readFile(join(source, "meta/_journal.json"), "utf8"),
      );
      journal.entries = journal.entries.slice(0, 2);
      await writeFile(
        join(folder, "meta/_journal.json"),
        JSON.stringify(journal),
      );
      for (const entry of journal.entries)
        await copyFile(
          join(source, entry.tag + ".sql"),
          join(folder, entry.tag + ".sql"),
        );
      await pool.query(
        "DROP SCHEMA public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public; CREATE EXTENSION IF NOT EXISTS vector",
      );
      await migrate(db, { migrationsFolder: folder });
      const user = (
        await pool.query(
          "INSERT INTO users(email) VALUES('legacy@example.invalid') RETURNING id",
        )
      ).rows[0].id;
      const area = (
        await pool.query(
          "INSERT INTO areas(user_id,name) VALUES($1,'Custom') RETURNING id",
          [user],
        )
      ).rows[0].id;
      const task = (
        await pool.query(
          "INSERT INTO tasks(user_id,area_id,title,due_date) VALUES($1,$2,'Keep me','2026-10-01') RETURNING id",
          [user, area],
        )
      ).rows[0].id;
      await migrate(db, { migrationsFolder: source });
      await runMigrations(pool);
      const row = (
        await pool.query(
          "SELECT title,due_date::text,revision FROM tasks WHERE id=$1",
          [task],
        )
      ).rows[0];
      assert.deepEqual(row, {
        title: "Keep me",
        due_date: "2026-10-01",
        revision: 1,
      });
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  },
);

test(
  "PostgreSQL OAuth attempts enforce owner, expiry and atomic single consumption",
  { skip: !enabled },
  async () => {
    const { pgOAuthAttemptStore } = await import("../google/oauth-store.js");
    const { issueOAuthState, consumeOAuthState, OAUTH_TTL_MS } =
      await import("../google/oauth-state.js");
    const user = (
      await pool.query(
        "INSERT INTO users(email) VALUES('oauth@example.invalid') RETURNING id",
      )
    ).rows[0].id;
    const other = (
      await pool.query(
        "INSERT INTO users(email) VALUES('oauth-other@example.invalid') RETURNING id",
      )
    ).rows[0].id;
    const state = await issueOAuthState(pgOAuthAttemptStore, user);
    assert.equal(
      await consumeOAuthState(pgOAuthAttemptStore, state, other),
      false,
    );
    const outcomes = await Promise.all([
      consumeOAuthState(pgOAuthAttemptStore, state, user),
      consumeOAuthState(pgOAuthAttemptStore, state, user),
    ]);
    assert.equal(outcomes.filter(Boolean).length, 1);
    const now = new Date();
    const expired = await issueOAuthState(pgOAuthAttemptStore, user, now);
    assert.equal(
      await consumeOAuthState(
        pgOAuthAttemptStore,
        expired,
        user,
        new Date(+now + OAUTH_TTL_MS),
      ),
      false,
    );
    const saved = (
      await pool.query(
        "SELECT state_hash FROM oauth_attempts WHERE user_id=$1",
        [user],
      )
    ).rows;
    assert.ok(
      saved.every(
        (row) => row.state_hash !== state && row.state_hash !== expired,
      ),
    );
  },
);

test(
  "daily API uses authenticated context for capture, move, focus and preferences",
  { skip: !enabled },
  async () => {
    const { Hono } = await import("hono");
    const { dailyRoutes } = await import("../routes/daily.js");
    const user = (
      await pool.query(
        "INSERT INTO users(email) VALUES('boundary-owner@example.invalid') RETURNING id",
      )
    ).rows[0].id;
    const other = (
      await pool.query(
        "INSERT INTO users(email) VALUES('boundary-other@example.invalid') RETURNING id",
      )
    ).rows[0].id;
    const app = new Hono<import("../types.js").AppEnv>();
    app.use("*", async (c, next) => {
      c.set("userId", user);
      await next();
    });
    app.route("/api/daily", dailyRoutes);
    const send = (path: string, body: unknown, method = "POST") =>
      app.request(`/api/daily/${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    const created = await send("capture", {
      userId: other,
      idempotencyKey: "context-capture",
      items: [{ title: "Authenticated owner", scheduledDate: "2026-10-01" }],
    });
    assert.equal(created.status, 200);
    const data = (await created.json()) as {
      tasks: { id: string; revision: number }[];
    };
    const task = data.tasks[0];
    assert.equal(
      (await pool.query("SELECT user_id FROM tasks WHERE id=$1", [task.id]))
        .rows[0].user_id,
      user,
    );
    const foreign = await capture(other, {
      idempotencyKey: "foreign-capture",
      items: [{ title: "Other user", scheduledDate: "2026-10-01" }],
    });
    assert.equal(
      (
        await send("move", {
          idempotencyKey: "foreign-move",
          scheduledDate: "2026-10-02",
          targets: [
            {
              targetType: "task",
              targetId: foreign.tasks[0].id,
              expectedRevision: 1,
            },
          ],
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await send(
          "focus",
          {
            date: "2026-10-01",
            targetType: "task",
            targetId: foreign.tasks[0].id,
          },
          "PUT",
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await send(
          "focus",
          { date: "2026-10-01", targetType: "task", targetId: task.id },
          "PUT",
        )
      ).status,
      200,
    );
    const selected = await app.request("/api/daily/focus?date=2026-10-01");
    assert.equal(
      ((await selected.json()) as { focus: { targetId: string } }).focus
        .targetId,
      task.id,
    );
    assert.equal(
      (
        await send(
          "preferences",
          { timezone: "Africa/Lagos", userId: other },
          "PATCH",
        )
      ).status,
      200,
    );
    assert.equal(
      (await pool.query("SELECT timezone FROM users WHERE id=$1", [other]))
        .rows[0].timezone,
      "UTC",
    );
  },
);

test(
  "account cascade deletion does not enqueue orphaned calendar events",
  { skip: !enabled },
  async () => {
    const user = (
      await pool.query(
        "INSERT INTO users(email) VALUES('delete-cascade@example.invalid') RETURNING id",
      )
    ).rows[0].id;
    await capture(user, {
      idempotencyKey: "delete-capture",
      items: [{ title: "Delete with owner" }],
    });
    await pool.query("DELETE FROM users WHERE id=$1", [user]);
    assert.equal(
      (await pool.query("SELECT count(*) FROM tasks WHERE user_id=$1", [user]))
        .rows[0].count,
      "0",
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*) FROM calendar_outbox WHERE user_id=$1",
          [user],
        )
      ).rows[0].count,
      "0",
    );
  },
);

async function syntheticUser(label: string, capacity = 120) {
  return (
    await pool.query(
      "INSERT INTO users(email,daily_capacity_minutes,efficiency_factor,buffer_factor) VALUES($1,$2,1,0) RETURNING id",
      [`${label}-${crypto.randomUUID()}@example.invalid`, capacity],
    )
  ).rows[0].id as string;
}
async function syntheticTask(
  user: string,
  title: string,
  options: {
    date?: string;
    priority?: string;
    depth?: string;
    energy?: string;
    status?: string;
    count?: number;
  } = {},
) {
  const area = (
    await pool.query(
      "INSERT INTO areas(user_id,name,system_key) VALUES($1,'General','general') ON CONFLICT(user_id,system_key) WHERE system_key IS NOT NULL DO UPDATE SET name=EXCLUDED.name RETURNING id",
      [user],
    )
  ).rows[0].id;
  return (
    await pool.query(
      "INSERT INTO tasks(user_id,area_id,title,scheduled_date,priority,work_depth,physical_energy,status,reschedule_count) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,revision",
      [
        user,
        area,
        title,
        options.date ?? null,
        options.priority ?? "normal",
        options.depth ?? null,
        options.energy ?? null,
        options.status ?? "todo",
        options.count ?? 0,
      ],
    )
  ).rows[0] as { id: string; revision: number };
}

test(
  "capture persists optional fields, duration, defaults, and a user-selected area",
  { skip: !enabled },
  async () => {
    const user = await syntheticUser("capture-fields");
    const area = (
      await pool.query(
        "INSERT INTO areas(user_id,name) VALUES($1,'Custom') RETURNING id",
        [user],
      )
    ).rows[0].id;
    const result = await capture(user, {
      idempotencyKey: "capture-variants",
      items: [
        { title: "Plain", areaId: area },
        {
          title: "Timed",
          scheduledDate: "2026-10-01",
          scheduledStartTime: "09:15",
          scheduledEndTime: "10:45",
          priority: "urgent",
          energyLevel: "deep_work",
          recurrenceRule: "FREQ=WEEKLY",
        },
        { title: "Estimate", estimatedMinutes: 45 },
        { title: "Start only", scheduledStartTime: "13:00" },
      ],
    });
    assert.equal(result.created, 4);
    assert.equal(result.tasks.length, 4);
    assert.equal(result.tasks[0].areaId, area);
    const plain = (
      await pool.query(
        "SELECT title,status,scheduled_date,priority,energy_level,recurrence_rule FROM tasks WHERE id=$1",
        [result.tasks[0].id],
      )
    ).rows[0];
    assert.deepEqual(plain, {
      title: "Plain",
      status: "backlog",
      scheduled_date: null,
      priority: "normal",
      energy_level: "shallow",
      recurrence_rule: null,
    });
    const timed = (
      await pool.query(
        "SELECT t.title,t.status,t.scheduled_date::text,t.scheduling_state,t.priority,t.energy_level,t.recurrence_rule,s.title AS child,s.estimated_minutes,s.scheduled_time FROM tasks t JOIN subtasks s ON s.task_id=t.id WHERE t.id=$1",
        [result.tasks[1].id],
      )
    ).rows[0];
    assert.match(timed.scheduled_time, /^09:15(?::00)?$/);
    assert.deepEqual(
      { ...timed, scheduled_time: "09:15" },
      {
        title: "Timed",
        status: "todo",
        scheduled_date: "2026-10-01",
        scheduling_state: "scheduled",
        priority: "urgent",
        energy_level: "deep_work",
        recurrence_rule: "FREQ=WEEKLY",
        child: "Timed",
        estimated_minutes: 90,
        scheduled_time: "09:15",
      },
    );
    assert.equal(
      (
        await pool.query(
          "SELECT estimated_minutes FROM subtasks WHERE task_id=$1",
          [result.tasks[2].id],
        )
      ).rows[0].estimated_minutes,
      45,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT estimated_minutes FROM subtasks WHERE task_id=$1",
          [result.tasks[3].id],
        )
      ).rows[0].estimated_minutes,
      null,
    );
    const blank = await pool.query("SELECT id FROM subtasks WHERE task_id=$1", [
      result.tasks[0].id,
    ]);
    assert.equal(blank.rowCount, 0);
  },
);

test(
  "moves reject terminal, deleted, missing and grouped targets; preserve deadlines and status",
  { skip: !enabled },
  async () => {
    const user = await syntheticUser("move-states");
    for (const status of ["done", "cancelled"]) {
      const target = await syntheticTask(user, status, { status });
      await assert.rejects(
        move(user, {
          idempotencyKey: `reject-${status}`,
          scheduledDate: "2026-10-01",
          targets: [
            { targetType: "task", targetId: target.id, expectedRevision: 1 },
          ],
        }),
        /no longer available/,
      );
    }
    const deleted = await syntheticTask(user, "deleted");
    await pool.query("UPDATE tasks SET deleted_at=now() WHERE id=$1", [
      deleted.id,
    ]);
    await assert.rejects(
      move(user, {
        idempotencyKey: "reject-deleted",
        scheduledDate: "2026-10-01",
        targets: [
          { targetType: "task", targetId: deleted.id, expectedRevision: 2 },
        ],
      }),
      /no longer available/,
    );
    await assert.rejects(
      move(user, {
        idempotencyKey: "reject-missing",
        scheduledDate: "2026-10-01",
        targets: [
          {
            targetType: "subtask",
            targetId: crypto.randomUUID(),
            expectedRevision: 1,
          },
        ],
      }),
      /no longer available/,
    );
    const parent = await syntheticTask(user, "group");
    const sub = (
      await pool.query(
        "INSERT INTO subtasks(task_id,title,completed) VALUES($1,'done child',true) RETURNING id",
        [parent.id],
      )
    ).rows[0];
    await assert.rejects(
      move(user, {
        idempotencyKey: "reject-parent",
        scheduledDate: "2026-10-01",
        targets: [
          { targetType: "task", targetId: parent.id, expectedRevision: 1 },
        ],
      }),
      /individual steps/,
    );
    await assert.rejects(
      move(user, {
        idempotencyKey: "reject-child",
        scheduledDate: "2026-10-01",
        targets: [
          { targetType: "subtask", targetId: sub.id, expectedRevision: 1 },
        ],
      }),
      /item changed/,
    );
    const open = await syntheticTask(user, "deadline", { status: "backlog" });
    await pool.query("UPDATE tasks SET due_date='2026-09-30' WHERE id=$1", [
      open.id,
    ]);
    const input = {
      idempotencyKey: "move-deadline",
      scheduledDate: "2026-10-02",
      targets: [
        { targetType: "task" as const, targetId: open.id, expectedRevision: 2 },
      ],
    };
    const moved = await move(user, input);
    assert.equal(moved.updated, 1);
    assert.deepEqual(moved.targets, [
      { ...input.targets[0], expectedRevision: 3 },
    ]);
    assert.deepEqual(await move(user, input), moved);
    assert.deepEqual(
      (
        await pool.query(
          "SELECT due_date::text,scheduled_date::text,status,scheduling_state FROM tasks WHERE id=$1",
          [open.id],
        )
      ).rows[0],
      {
        due_date: "2026-09-30",
        scheduled_date: "2026-10-02",
        status: "todo",
        scheduling_state: "scheduled",
      },
    );
  },
);

test(
  "focus selects only the requested execution item and invalidates on completion or date change",
  { skip: !enabled },
  async () => {
    const user = await syntheticUser("focus-units");
    const parent = await syntheticTask(user, "parent");
    const children = (
      await pool.query(
        "INSERT INTO subtasks(task_id,title,scheduled_date) VALUES($1,'one','2026-10-01'),($1,'two','2026-10-01') RETURNING id",
        [parent.id],
      )
    ).rows;
    const focus = {
      date: "2026-10-01",
      targetType: "subtask" as const,
      targetId: children[1].id,
    };
    assert.deepEqual(await setFocus(user, focus), { focus });
    assert.deepEqual(await getFocus(user, focus.date), { focus });
    assert.deepEqual(await getFocus(user, "2026-10-02"), { focus: null });
    await assert.rejects(
      setFocus(user, { ...focus, date: "2026-10-02" }),
      /item changed/,
    );
    await pool.query("UPDATE subtasks SET completed=true WHERE id=$1", [
      focus.targetId,
    ]);
    assert.deepEqual(await getFocus(user, focus.date), { focus: null });
    const standalone = await syntheticTask(user, "next", {
      date: "2026-10-01",
    });
    await setFocus(user, {
      ...focus,
      targetType: "task",
      targetId: standalone.id,
    });
    await pool.query("UPDATE tasks SET status='done' WHERE id=$1", [
      standalone.id,
    ]);
    assert.deepEqual(await getFocus(user, focus.date), { focus: null });
  },
);

test(
  "capacity blends sufficient history and clamps unusually low and high observations",
  { skip: !enabled },
  async () => {
    const { calculateDailyCapacity, getObservedDailyMinutes } =
      await import("./scheduler.js");
    const asOf = new Date("2026-11-10T12:00:00Z");
    assert.equal(
      await calculateDailyCapacity(db, crypto.randomUUID(), asOf),
      0,
    );
    for (const [minutes, expected] of [
      [1, 72],
      [120, 120],
      [10000, 180],
    ]) {
      const user = await syntheticUser(`capacity-${minutes}`);
      const parent = await syntheticTask(user, "history");
      for (let d = 1; d <= 4; d++)
        await pool.query(
          "INSERT INTO subtasks(task_id,title,completed,completed_at,estimated_minutes) VALUES($1,'done',true,$2,$3)",
          [parent.id, `2026-11-0${d}T12:00:00Z`, minutes],
        );
      assert.equal(await getObservedDailyMinutes(db, user, asOf), null);
      assert.equal(await calculateDailyCapacity(db, user, asOf), 120);
      await pool.query(
        "INSERT INTO subtasks(task_id,title,completed,completed_at,estimated_minutes) VALUES($1,'fifth',true,'2026-11-05T12:00:00Z',$2)",
        [parent.id, minutes],
      );
      assert.equal(await getObservedDailyMinutes(db, user, asOf), minutes);
      assert.equal(await calculateDailyCapacity(db, user, asOf), expected);
    }
  },
);

test(
  "learning splits elapsed time through DST fallback and does not multiply joined completions",
  { skip: !enabled },
  async () => {
    const user = await syntheticUser("dst");
    await pool.query(
      "UPDATE users SET timezone='America/New_York' WHERE id=$1",
      [user],
    );
    const parent = await syntheticTask(user, "history");
    const asOf = new Date("2026-11-05T12:00:00Z");
    // Four small observations plus the repeated 01:00 hour during the fall-back day.
    for (const date of ["2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31"])
      await pool.query(
        "INSERT INTO task_time_logs(task_id,started_at,ended_at) VALUES($1,$2::timestamptz,$2::timestamptz+interval '10 minutes')",
        [parent.id, `${date}T16:00:00Z`],
      );
    assert.equal(
      (await getScheduleLearningSummary(db, user, asOf)).peakHour,
      null,
    );
    await pool.query(
      "INSERT INTO task_time_logs(task_id,started_at,ended_at) VALUES($1,'2026-11-01T05:30:00Z','2026-11-01T07:30:00Z')",
      [parent.id],
    );
    await pool.query(
      "INSERT INTO subtasks(task_id,title,completed,completed_at) VALUES($1,'done',true,'2026-11-01T18:00:00Z'),($1,'also done',true,'2026-11-01T18:00:00Z')",
      [parent.id],
    );
    const summary = await getScheduleLearningSummary(db, user, asOf);
    assert.equal(summary.peakHour, 1);
    assert.deepEqual(summary.deepWorkHours, [1, 2]);
    assert.equal(summary.observedCompletionCount, 2);
  },
);

test(
  "preview prioritizes urgency, work depth and energy and uses available destination capacity",
  { skip: !enabled },
  async () => {
    const user = await syntheticUser("preview-order", 60);
    const existing = await syntheticTask(user, "already planned", {
      date: "2026-10-01",
    });
    const low = await syntheticTask(user, "low", {
      date: "2026-09-29",
      priority: "low",
      count: 4,
    });
    const normal = await syntheticTask(user, "normal", {
      date: "2026-09-29",
      depth: "normal",
      energy: "medium",
    });
    const deep = await syntheticTask(user, "deep", {
      date: "2026-09-29",
      depth: "deep",
      energy: "high",
    });
    const high = await syntheticTask(user, "high", {
      date: "2026-09-29",
      priority: "high",
    });
    const urgent = await syntheticTask(user, "urgent", {
      date: "2026-09-29",
      priority: "urgent",
    });
    const done = await syntheticTask(user, "done", {
      date: "2026-09-29",
      status: "done",
    });
    const cancelled = await syntheticTask(user, "cancelled", {
      date: "2026-09-29",
      status: "cancelled",
    });
    const p = await buildSchedulePreview(db, user, {
      fromDate: "2026-10-01",
      horizonEnd: "2026-10-03",
    });
    assert.deepEqual(
      p.proposals.map((x: any) => x.targetId),
      [urgent.id, high.id, deep.id, normal.id, low.id],
    );
    assert.deepEqual(
      p.proposals.map((x: any) => x.toDate),
      ["2026-10-01", "2026-10-02", "2026-10-02", "2026-10-03", "2026-10-03"],
    );
    assert.deepEqual(
      p.proposals.map((x: any) => x.risk),
      ["high", "medium", "low", "low", "low"],
    );
    assert.equal(p.learning.dailyCapacity, 60);
    assert.ok(p.previewId);
    assert.ok(new Date(p.expiresAt) > new Date());
    assert.ok(
      p.proposals.every(
        (x: any) =>
          x.fromDate === "2026-09-29" &&
          x.expectedRevision === 1 &&
          x.estimatedMinutes === 30,
      ),
    );
    assert.ok(
      p.proposals.every(
        (x: any) => ![existing.id, done.id, cancelled.id].includes(x.targetId),
      ),
    );
    assert.ok(p.proposals[0].reason.includes("available capacity"));
  },
);

test(
  "preview respects scheduled children, normalizes estimates and selects least-loaded overflow day",
  { skip: !enabled },
  async () => {
    const user = await syntheticUser("preview-children", 30);
    const parent = await syntheticTask(user, "parent");
    await pool.query(
      "INSERT INTO subtasks(task_id,title,scheduled_date,estimated_minutes) VALUES($1,'booked','2026-10-01',30),($1,'booked2','2026-10-02',60)",
      [parent.id],
    );
    const children = (
      await pool.query(
        "INSERT INTO subtasks(task_id,title,scheduled_date,estimated_minutes) VALUES($1,'small','2026-09-29',0),($1,'large','2026-09-29',700) RETURNING id",
        [parent.id],
      )
    ).rows;
    const p = await buildSchedulePreview(db, user, {
      fromDate: "2026-10-01",
      horizonEnd: "2026-10-02",
    });
    assert.equal(p.proposals.length, 2);
    assert.equal(p.proposals[0].targetType, "subtask");
    assert.deepEqual(
      p.proposals.map((x: any) => x.estimatedMinutes),
      [30, 480],
    );
    assert.equal(p.proposals[0].toDate, "2026-10-01");
    assert.equal(p.proposals[0].risk, "high");
    assert.ok(p.proposals[0].reason.includes("least-loaded"));
    const first = p.proposals.find((x: any) => x.targetId === children[0].id)!;
    const result = await applyScheduleProposals(db, user, {
      previewId: p.previewId,
      selectedIds: [first.id],
      idempotencyKey: "apply-child",
    });
    assert.deepEqual(result, { applied: 1, skipped: 0 });
    assert.equal(
      (
        await pool.query(
          "SELECT scheduled_date::text FROM subtasks WHERE id=$1",
          [children[0].id],
        )
      ).rows[0].scheduled_date,
      "2026-10-01",
    );
    assert.equal(
      (
        await pool.query(
          "SELECT scheduled_date::text FROM subtasks WHERE id=$1",
          [children[1].id],
        )
      ).rows[0].scheduled_date,
      "2026-09-29",
    );
  },
);

test(
  "apply rejects expired, foreign, invented and duplicate preview selections atomically",
  { skip: !enabled },
  async () => {
    const user = await syntheticUser("preview-rejections");
    const other = await syntheticUser("preview-other");
    const task = await syntheticTask(user, "due", { date: "2026-09-29" });
    const p = await buildSchedulePreview(db, user, {
      fromDate: "2026-10-01",
      horizonEnd: "2026-10-01",
    });
    const id = p.proposals[0].id;
    for (const selectedIds of [["invented"], [id, id]])
      await assert.rejects(
        applyScheduleProposals(db, user, {
          previewId: p.previewId,
          selectedIds,
          idempotencyKey: crypto.randomUUID(),
        }),
        /Invalid preview selection/,
      );
    await assert.rejects(
      applyScheduleProposals(db, other, {
        previewId: p.previewId,
        selectedIds: [id],
        idempotencyKey: "foreign-preview",
      }),
      /Preview expired/,
    );
    await pool.query(
      "UPDATE schedule_previews SET expires_at=now()-interval '1 second' WHERE id=$1",
      [p.previewId],
    );
    await assert.rejects(
      applyScheduleProposals(db, user, {
        previewId: p.previewId,
        selectedIds: [id],
        idempotencyKey: "expired-preview",
      }),
      /Preview expired/,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT revision,scheduled_date::text FROM tasks WHERE id=$1",
          [task.id],
        )
      ).rows[0].revision,
      1,
    );
  },
);

test(
  "destination insertion after preview invalidates context, and concurrent applies cannot double-move",
  { skip: !enabled },
  async () => {
    const user = await syntheticUser("context-insert");
    const task = await syntheticTask(user, "old", { date: "2026-09-29" });
    const stale = await buildSchedulePreview(db, user, {
      fromDate: "2026-10-01",
      horizonEnd: "2026-10-01",
    });
    await syntheticTask(user, "new capacity consumer", { date: "2026-10-01" });
    await assert.rejects(
      applyScheduleProposals(db, user, {
        previewId: stale.previewId,
        selectedIds: [stale.proposals[0].id],
        idempotencyKey: "after-insert",
      }),
      /plan or capacity changed/,
    );
    const p = await buildSchedulePreview(db, user, {
      fromDate: "2026-10-01",
      horizonEnd: "2026-10-01",
    });
    const outcomes = await Promise.allSettled(
      ["one", "two"].map((key) =>
        applyScheduleProposals(db, user, {
          previewId: p.previewId,
          selectedIds: [p.proposals[0].id],
          idempotencyKey: `parallel-${key}`,
        }),
      ),
    );
    assert.equal(outcomes.filter((x) => x.status === "fulfilled").length, 1);
    assert.equal(outcomes.filter((x) => x.status === "rejected").length, 1);
    assert.deepEqual(
      (
        await pool.query(
          "SELECT revision,reschedule_count,scheduled_date::text,is_auto_scheduled FROM tasks WHERE id=$1",
          [task.id],
        )
      ).rows[0],
      {
        revision: 2,
        reschedule_count: 1,
        scheduled_date: "2026-10-01",
        is_auto_scheduled: true,
      },
    );
  },
);

test(
  "legacy scheduler anchors urgent and running work and escalates repeated overflow",
  { skip: !enabled },
  async () => {
    const { runAutoScheduler } = await import("./scheduler.js");
    const user = await syntheticUser("legacy", 30);
    assert.deepEqual(await runAutoScheduler(db, user, "2026-10-01"), {
      displaced: 0,
      dailyCapacity: 0,
    });
    const low = await syntheticTask(user, "low", {
      date: "2026-10-01",
      priority: "low",
      count: 3,
    });
    const high = await syntheticTask(user, "high", {
      date: "2026-10-01",
      priority: "high",
    });
    const urgent = await syntheticTask(user, "urgent", {
      date: "2026-10-01",
      priority: "urgent",
    });
    const running = await syntheticTask(user, "running", {
      date: "2026-10-01",
      status: "in_progress",
    });
    const result = await runAutoScheduler(db, user, "2026-10-01");
    assert.equal(result.dailyCapacity, 30);
    assert.equal(result.displaced, 2);
    assert.equal(result.usedMinutes, 60);
    assert.deepEqual(result.scheduled, [running.id, urgent.id]);
    assert.deepEqual(
      (
        await pool.query(
          "SELECT scheduled_date::text,reschedule_count,scheduling_state,is_auto_scheduled FROM tasks WHERE id=$1",
          [low.id],
        )
      ).rows[0],
      {
        scheduled_date: "2026-10-02",
        reschedule_count: 4,
        scheduling_state: "needs_rescheduling",
        is_auto_scheduled: true,
      },
    );
    assert.equal(
      (
        await pool.query("SELECT scheduling_state FROM tasks WHERE id=$1", [
          high.id,
        ])
      ).rows[0].scheduling_state,
      "overflow",
    );
  },
);

test(
  "receipt retries only transient database failures, bounds retries and replays acknowledged work",
  { skip: !enabled },
  async () => {
    const { receipt } = await import("./daily.js");
    const user = await syntheticUser("receipt-fault");
    let attempts = 0;
    const operation = async () => {
      attempts++;
      if (attempts < 3)
        throw Object.assign(new Error("transient"), {
          code: attempts === 1 ? "40001" : "40P01",
        });
      return { saved: true };
    };
    assert.deepEqual(
      await receipt(user, "retry", "same-key", { title: "same" }, operation),
      { saved: true },
    );
    assert.equal(attempts, 3);
    assert.deepEqual(
      await receipt(user, "retry", "same-key", { title: "same" }, operation),
      { saved: true },
    );
    assert.equal(attempts, 3);
    await assert.rejects(
      receipt(user, "retry", "same-key", { title: "changed" }, operation),
      /different changes/,
    );
    assert.equal(attempts, 3);
    let failures = 0;
    await assert.rejects(
      receipt(user, "retry", "bounded", {}, async () => {
        failures++;
        throw Object.assign(new Error("deadlock"), { code: "40P01" });
      }),
      /deadlock/,
    );
    assert.equal(failures, 3);
    let permanent = 0;
    await assert.rejects(
      receipt(user, "retry", "permanent", {}, async () => {
        permanent++;
        throw Object.assign(new Error("constraint"), { code: "23503" });
      }),
      /constraint/,
    );
    assert.equal(permanent, 1);
    assert.equal(
      (
        await pool.query(
          "SELECT count(*) FROM mutation_receipts WHERE user_id=$1",
          [user],
        )
      ).rows[0].count,
      "1",
    );
  },
);

test(
  "midnight learning recommendations wrap and spring-forward logs omit the nonexistent hour",
  { skip: !enabled },
  async () => {
    const midnight = await syntheticUser("midnight");
    const task = await syntheticTask(midnight, "night");
    const asOf = new Date("2026-11-10T12:00:00Z");
    for (let day = 1; day <= 5; day++)
      await pool.query(
        "INSERT INTO task_time_logs(task_id,started_at,ended_at) VALUES($1,$2::timestamptz,$2::timestamptz+interval '30 minutes')",
        [task.id, `2026-11-0${day}T23:00:00Z`],
      );
    assert.deepEqual(
      (await getScheduleLearningSummary(db, midnight, asOf)).deepWorkHours,
      [23, 0],
    );
    const spring = await syntheticUser("spring");
    await pool.query(
      "UPDATE users SET timezone='America/New_York' WHERE id=$1",
      [spring],
    );
    const springTask = await syntheticTask(spring, "spring");
    for (const day of ["04", "05", "06", "07"])
      await pool.query(
        "INSERT INTO task_time_logs(task_id,started_at,ended_at) VALUES($1,$2::timestamptz,$2::timestamptz+interval '1 minute')",
        [springTask.id, `2026-03-${day}T17:00:00Z`],
      );
    await pool.query(
      "INSERT INTO task_time_logs(task_id,started_at,ended_at) VALUES($1,'2026-03-08T06:30:00Z','2026-03-08T07:45:00Z')",
      [springTask.id],
    );
    const summary = await getScheduleLearningSummary(
      db,
      spring,
      new Date("2026-03-10T12:00:00Z"),
    );
    assert.equal(summary.peakHour, 3);
    assert.deepEqual(summary.deepWorkHours, [3, 4]);
    assert.equal(summary.observedCompletionCount, 0);
  },
);

test(
  "a database exception after the first write rolls back capture receipts and all task rows",
  { skip: !enabled },
  async () => {
    const user = await syntheticUser("rollback-injection");
    await pool.query(
      `CREATE OR REPLACE FUNCTION reject_test_title() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.title='synthetic fail second row' THEN RAISE EXCEPTION 'injected failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER synthetic_capture_failure BEFORE INSERT ON tasks FOR EACH ROW EXECUTE FUNCTION reject_test_title()`,
    );
    try {
      await assert.rejects(
        capture(user, {
          idempotencyKey: "partial-db-error",
          items: [
            { title: "first must rollback" },
            { title: "synthetic fail second row" },
          ],
        }),
        /injected failure/,
      );
      assert.equal(
        (
          await pool.query("SELECT count(*) FROM tasks WHERE user_id=$1", [
            user,
          ])
        ).rows[0].count,
        "0",
      );
      assert.equal(
        (
          await pool.query(
            "SELECT count(*) FROM mutation_receipts WHERE user_id=$1",
            [user],
          )
        ).rows[0].count,
        "0",
      );
      assert.equal(
        (
          await pool.query(
            "SELECT count(*) FROM calendar_outbox WHERE user_id=$1",
            [user],
          )
        ).rows[0].count,
        "0",
      );
    } finally {
      await pool.query(
        "DROP TRIGGER synthetic_capture_failure ON tasks; DROP FUNCTION reject_test_title()",
      );
    }
  },
);

test(
  "capacity uses configured efficiency and buffer and work scores break ties predictably",
  { skip: !enabled },
  async () => {
    const { calculateDailyCapacity } = await import("./scheduler.js");
    const user = await syntheticUser("scoring", 101);
    await pool.query(
      "UPDATE users SET efficiency_factor=0.8,buffer_factor=0.2 WHERE id=$1",
      [user],
    );
    assert.equal(await calculateDailyCapacity(db, user), 64);
    await pool.query(
      "UPDATE users SET daily_capacity_minutes=1000,efficiency_factor=1,buffer_factor=0 WHERE id=$1",
      [user],
    );
    const low = await syntheticTask(user, "low energy", {
      date: "2026-09-29",
      depth: "normal",
      energy: "low",
    });
    const aged = await syntheticTask(user, "aged medium", {
      date: "2026-09-29",
      depth: "normal",
      energy: "medium",
      count: 3,
    });
    const medium = await syntheticTask(user, "medium energy", {
      date: "2026-09-29",
      depth: "normal",
      energy: "medium",
    });
    const high = await syntheticTask(user, "high energy", {
      date: "2026-09-29",
      depth: "normal",
      energy: "high",
    });
    const deep = await syntheticTask(user, "deep work", {
      date: "2026-09-29",
      depth: "deep",
      energy: "low",
    });
    const p = await buildSchedulePreview(db, user, {
      fromDate: "2026-10-01",
      horizonEnd: "2026-10-01",
    });
    assert.deepEqual(
      p.proposals.map((v: any) => v.targetId),
      [deep.id, high.id, medium.id, low.id, aged.id],
    );
  },
);
