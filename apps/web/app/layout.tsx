import {ClerkProvider} from "@clerk/nextjs";
import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "DevPlanner",
  description: "ADHD-optimized personal productivity",
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