import path from "path";
import { fileURLToPath } from "url";
import nextEnv from "@next/env";

// Monorepo: load repo-root `.env` / `.env.local` so NextAuth + DB match the API (Next only reads `apps/web/.env*` by default).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
nextEnv.loadEnvConfig(repoRoot);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Fewer modules to compile when importing icons (helps dev on slow filesystems).
    optimizePackageImports: ["lucide-react"],
  },
  // outputFileTracingRoot is not valid on Next 14.2.x top-level config (warns and is ignored).
  // WSL + /mnt/c: use `npm run dev:webpack` for Watchpack polling, or move the repo to ~/ in WSL.
};

export default nextConfig;
