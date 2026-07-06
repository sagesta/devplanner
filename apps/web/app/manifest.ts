import type { MetadataRoute } from "next";

// Served at /manifest.webmanifest and auto-linked by Next.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "DevPlanner",
    short_name: "DevPlanner",
    description: "ADHD-optimized personal productivity",
    start_url: "/now",
    display: "standalone",
    background_color: "#171614",
    theme_color: "#01696f",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Same full-bleed art doubles as maskable: the bolt sits inside the 80% safe zone.
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
