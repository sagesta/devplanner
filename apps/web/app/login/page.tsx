"use client";

import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";

export default function LoginPage() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4 text-foreground">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-surface p-8 shadow-xl">
        <h1 className="font-display text-3xl tracking-tight text-foreground">DevPlanner</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Turn big goals into months, weeks, and today&apos;s next step.
        </p>

        {error === "AccessDenied" && (
          <p className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200/90">
            This is a private instance. Ask the owner to add your email to the allowlist.
          </p>
        )}

        <button
          type="button"
          onClick={() => signIn("google", { callbackUrl: "/now" })}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-medium text-[#141311] transition hover:bg-white/90"
        >
          Sign in with Google
        </button>

        <p className="mt-4 text-center text-[11px] text-muted/85">
          Capture &rarr; plan &rarr; do &rarr; review. One calm loop.
        </p>
      </div>
    </div>
  );
}
