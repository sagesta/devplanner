import { getApiBase } from "./env";

const original = process.env.NEXT_PUBLIC_API_URL;

afterEach(() => {
  if (original === undefined) delete process.env.NEXT_PUBLIC_API_URL;
  else process.env.NEXT_PUBLIC_API_URL = original;
});

test("uses the configured API origin", () => {
  process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
  expect(getApiBase()).toBe("https://api.example.test");
});

test("falls back to the local API in development", () => {
  delete process.env.NEXT_PUBLIC_API_URL;
  expect(getApiBase()).toBe("http://localhost:3001");
});
