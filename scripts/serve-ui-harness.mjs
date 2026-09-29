import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
const root = process.cwd(),
  out = mkdtempSync(path.join(tmpdir(), "devplanner-ui-"));
await build({
  entryPoints: ["tests/ui-harness/app.tsx"],
  bundle: true,
  outfile: path.join(out, "app.js"),
  platform: "browser",
  jsx: "automatic",
  sourcemap: true,
  define: {
    "process.env.NODE_ENV": '"development"',
    "process.env.NEXT_PUBLIC_API_URL": '"http://127.0.0.1:4173"',
  },
  alias: { "@": path.join(root, "apps/web") },
  plugins: [
    {
      name: "test-framework",
      setup(b) {
        b.onResolve(
          { filter: /^(next\/(link|navigation)|@clerk\/nextjs)$/ },
          () => ({ path: path.join(root, "tests/ui-harness/framework.tsx") }),
        );
      },
    },
  ],
});
const css = spawnSync(
  process.execPath,
  [
    path.join(root, "node_modules/tailwindcss/lib/cli.js"),
    "-c",
    "tailwind.config.ts",
    "-i",
    "app/globals.css",
    "-o",
    path.join(out, "app.css"),
  ],
  { cwd: path.join(root, "apps/web"), stdio: "inherit" },
);
if (css.status !== 0) process.exit(css.status ?? 1);
const server = createServer((req, res) => {
  if (
    req.url === "/app.js" ||
    req.url === "/app.js.map" ||
    req.url === "/app.css"
  ) {
    res.setHeader(
      "Content-Type",
      req.url.endsWith("css") ? "text/css" : "application/javascript",
    );
    res.end(readFileSync(path.join(out, req.url.slice(1))));
    return;
  }
  if (req.url?.startsWith("/api/")) {
    res.writeHead(501);
    res.end("Tests must explicitly mock each API request");
    return;
  }
  res.setHeader("Content-Type", "text/html");
  res.end(
    '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>DevPlanner component test</title><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>',
  );
});
server.listen(4173, "127.0.0.1", () =>
  process.stdout.write("Synthetic UI harness on http://127.0.0.1:4173\n"),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => server.close(() => process.exit(0)));
