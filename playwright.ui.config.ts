import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/ui",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30000,
  reporter: [
    ["list"],
    ["json", { outputFile: "docs/evidence/ui-browser-results.json" }],
  ],
  use: { baseURL: "http://127.0.0.1:4173", trace: "retain-on-failure" },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 5"], viewport: { width: 360, height: 800 } },
    },
  ],
  webServer: {
    command: "node scripts/serve-ui-harness.mjs",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
