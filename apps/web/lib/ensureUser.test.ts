import postgres from "postgres";
import { getAppSql, upsertUserByEmail } from "./ensureUser";
jest.mock("postgres", () => ({ __esModule: true, default: jest.fn() }));
const sql = jest.fn();
const previous = process.env.DATABASE_URL;
beforeEach(() => {
  jest.clearAllMocks();
  process.env.DATABASE_URL = "postgres://synthetic.invalid/test";
  jest.mocked(postgres).mockReturnValue(sql as never);
});
afterAll(() => {
  if (previous === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previous;
});
test("missing database configuration fails clearly before a connection", () => {
  delete process.env.DATABASE_URL;
  expect(() => getAppSql()).toThrow("DATABASE_URL is not set");
  expect(postgres).not.toHaveBeenCalled();
});
test("new users receive default areas and a stable internal identifier", async () => {
  sql
    .mockResolvedValueOnce([{ id: "internal" }])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([]);
  expect(await upsertUserByEmail("owner@example.test", "Owner")).toBe(
    "internal",
  );
  expect(sql.mock.calls[0].slice(1)).toEqual(["owner@example.test", "Owner"]);
  expect(sql.mock.calls[2][0].join("")).toContain("INSERT INTO areas");
  expect(sql.mock.calls[2].slice(1)).toEqual([
    "internal",
    "internal",
    "internal",
  ]);
  expect(postgres).toHaveBeenCalledWith("postgres://synthetic.invalid/test", {
    max: 1,
  });
});
test("existing users keep their areas and legacy growth area names are normalized", async () => {
  sql
    .mockResolvedValueOnce([{ id: "existing" }])
    .mockResolvedValueOnce([{ id: "area" }])
    .mockResolvedValueOnce([]);
  expect(await upsertUserByEmail("owner@example.test", null)).toBe("existing");
  expect(sql.mock.calls[2][0].join("")).toContain("UPDATE areas");
  expect(sql.mock.calls[2][1]).toBe("existing");
  expect(postgres).not.toHaveBeenCalled();
});
test("failed user creation cannot continue with area writes", async () => {
  sql.mockResolvedValueOnce([]);
  await expect(upsertUserByEmail("owner@example.test", null)).rejects.toThrow(
    "Failed to upsert user",
  );
  expect(sql).toHaveBeenCalledTimes(1);
});
