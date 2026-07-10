"use client";

import { useUser } from "@clerk/nextjs";
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
    <div className="mx-auto flex max-w-[1100px] flex-col gap-6 pb-16">
      <GoalHorizonsMatrix ownerName={ownerName} standalone />
    </div>
  );
}
