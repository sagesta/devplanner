import { auth, currentUser } from "@clerk/nextjs/server";
import { getAppSql, upsertUserByEmail } from "@/lib/ensureUser";
import { GET, PUT } from "./route";
jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
  currentUser: jest.fn(),
}));
jest.mock("@/lib/ensureUser", () => ({
  getAppSql: jest.fn(),
  upsertUserByEmail: jest.fn(),
}));
jest.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, options?: { status: number }) => ({
      status: options?.status ?? 200,
      json: async () => body,
    }),
  },
}));
const sql = Object.assign(jest.fn(), {
  json: jest.fn((value: unknown) => value),
});
const allowed = process.env.ALLOWED_EMAILS;
beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.ALLOWED_EMAILS;
  jest.mocked(auth).mockResolvedValue({ userId: "clerk-owner" } as never);
  jest.mocked(currentUser).mockResolvedValue({
    primaryEmailAddress: { emailAddress: " OWNER@example.test " },
    fullName: "Owner",
  } as never);
  jest.mocked(upsertUserByEmail).mockResolvedValue("internal-owner");
  jest.mocked(getAppSql).mockReturnValue(sql as never);
});
afterAll(() => {
  if (allowed === undefined) delete process.env.ALLOWED_EMAILS;
  else process.env.ALLOWED_EMAILS = allowed;
});
test.each(["signed-out", "no-email", "disallowed"])(
  "goals reject %s before any database call",
  async (mode) => {
    if (mode === "signed-out")
      jest.mocked(auth).mockResolvedValue({ userId: null } as never);
    if (mode === "no-email") jest.mocked(currentUser).mockResolvedValue(null);
    if (mode === "disallowed")
      process.env.ALLOWED_EMAILS = "different@example.test";
    const result = await GET();
    expect(result.status).toBe(mode === "disallowed" ? 403 : 401);
    expect(sql).not.toHaveBeenCalled();
    expect(upsertUserByEmail).not.toHaveBeenCalled();
  },
);
test("read is scoped to internal owner and returns a complete empty matrix for a new account", async () => {
  process.env.ALLOWED_EMAILS = "other@example.test, owner@example.test";
  sql.mockResolvedValue([]);
  const result = await GET();
  const body = await result.json();
  expect(upsertUserByEmail).toHaveBeenCalledWith("owner@example.test", "Owner");
  expect(sql.mock.calls[1][1]).toBe("internal-owner");
  expect(Object.keys(body.goals)).toHaveLength(9);
  expect(Object.values(body.goals).every((v) => v === "")).toBe(true);
  expect(body.updatedAt).toBeNull();
});
test("read normalizes persisted goal values and dates", async () => {
  sql.mockResolvedValueOnce([]).mockResolvedValueOnce([
    {
      owner_name: "Owner",
      goals: {
        "short:work": "Ship",
        "mid:work": 25,
        "long:work": "x".repeat(2100),
      },
      updated_at: "2026-09-29T00:00:00Z",
    },
  ]);
  const body = await (await GET()).json();
  expect(body.goals["short:work"]).toBe("Ship");
  expect(body.goals["mid:work"]).toBe("");
  expect(body.goals["long:work"]).toHaveLength(2000);
  expect(body.updatedAt).toBe("2026-09-29T00:00:00.000Z");
});
test("write uses the authenticated owner, bounds text and discards unknown goal keys", async () => {
  sql.mockResolvedValueOnce([]).mockResolvedValueOnce([
    {
      owner_name: "Owner",
      goals: { "short:work": "Ship" },
      updated_at: "2026-09-29T00:00:00Z",
    },
  ]);
  const result = await PUT({
    json: async () => ({
      userId: "attacker",
      ownerName: " Owner ",
      goals: { "short:work": "Ship", unknown: "ignored" },
    }),
  } as Request);
  expect(result.status).toBe(200);
  expect(sql.mock.calls[1].slice(1, 3)).toEqual(["internal-owner", "Owner"]);
  expect(sql.json).toHaveBeenCalledWith(
    expect.objectContaining({ "short:work": "Ship" }),
  );
  expect(sql.json.mock.calls[0][0]).not.toHaveProperty("unknown");
});
