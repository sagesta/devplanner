import {ClerkProvider} from "@clerk/nextjs";
import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "DevPlanner",
  description: "ADHD-optimized personal productivity",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "DevPlanner",
  },
  icons: {
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#171614",
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body
        style={
          {
            "--font-satoshi": '"Satoshi", system-ui, sans-serif',
            "--font-instrument": '"Instrument Serif", Georgia, serif',
          } as React.CSSProperties
        }
      >
        <ClerkProvider>
          <Providers>{children}</Providers>
        </ClerkProvider>
      </body>
    </html>
  );
}