const base = require("./jest.config");
module.exports = async () => ({
  ...(await base()),
  collectCoverage: true,
  collectCoverageFrom: [
    "app/**/*.{ts,tsx}",
    "components/**/*.{ts,tsx}",
    "hooks/**/*.{ts,tsx}",
    "lib/**/*.{ts,tsx}",
    "!**/*.test.*",
  ],
  coverageDirectory: "../../coverage/web",
  coverageReporters: ["text-summary", "json-summary", "lcov"],
  coverageThreshold: {
    global: { branches: 80, functions: 80, lines: 80, statements: 80 },
    "./lib/draft-storage.ts": {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90,
    },
    "./hooks/use-calendar-date.ts": {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90,
    },
  },
});
