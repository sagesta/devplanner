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
