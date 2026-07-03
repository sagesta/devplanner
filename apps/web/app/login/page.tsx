"use client";

import { SignIn } from "@clerk/nextjs";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background p-4 text-foreground">
      <div className="text-center">
        <h1 className="font-display text-3xl tracking-tight text-foreground">DevPlanner</h1>
        <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted">
          Turn big goals into months, weeks, and today&apos;s next step.
        </p>
      </div>

      <SignIn
        routing="hash"
        fallbackRedirectUrl="/now"
        appearance={{
          variables: {
            colorBackground: "#1c1b19",
            colorText: "#f7f6f2",
            colorTextSecondary: "#9c9890",
            colorPrimary: "#01696f",
            colorInputBackground: "#171614",
            colorInputText: "#f7f6f2",
            borderRadius: "0.75rem",
          },
        }}
      />

      <p className="max-w-xs text-center text-[11px] leading-relaxed text-muted/85">
        This is a private instance — if your email isn&apos;t allowed in yet, ask the owner to
        add it. Capture &rarr; plan &rarr; do &rarr; review. One calm loop.
      </p>
    </div>
  );
}
