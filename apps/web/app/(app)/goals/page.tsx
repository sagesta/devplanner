"use client";

import { ArrowRight, CalendarCheck, Target } from "lucide-react";
import { useUser } from "@clerk/nextjs";
import Link from "next/link";
import { GoalHorizonsMatrix } from "@/components/goal-horizons-matrix";

function displayNameFromSession(name?: string | null, email?: string | null) {
  if (name?.trim()) return name.trim();
  if (email?.trim()) return email.split("@")[0];
  return "Me";
}

export default function GoalsPage() {
  const { user } = useUser();
  const ownerName = displayNameFromSession(user?.fullName, user?.primaryEmailAddress?.emailAddress);

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-5 pb-10">
      <header className="flex flex-col gap-4 border-b border-white/10 pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Direction setting</p>
          <h1 className="mt-1 text-2xl font-semibold text-foreground">Goals</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Keep the big picture visible across short, mid, and long-term horizons.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            href="/now"
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-white/10"
          >
            <Target size={14} />
            Today
          </Link>
          <Link
            href="/review"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-primary-hover"
          >
            <CalendarCheck size={14} />
            Weekly review
            <ArrowRight size={14} />
          </Link>
        </div>
      </header>

      <GoalHorizonsMatrix ownerName={ownerName} />
    </div>
  );
}
