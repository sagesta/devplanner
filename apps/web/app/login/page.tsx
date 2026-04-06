"use client";

import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";

export default function LoginPage() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#141311] p-4 text-[#f7f6f2]">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#1c1b19] p-8 shadow-xl">
        <h1 className="font-[family-name:var(--font-instrument)] text-2xl tracking-tight text-[#f7f6f2]">
          DevPlanner
        </h1>
        <p className="mt-2 text-sm text-white/60">Sign in to continue</p>

        {error === "AccessDenied" && (
          <p className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200/90">
            You are not allowed to access this app.
          </p>
        )}

        <button
          type="button"
          onClick={() => signIn("google", { callbackUrl: "/board" })}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-medium text-[#141311] transition hover:bg-white/90"
        >
          Sign in with Google
        </button>
      </div>
    </div>
  );
}
