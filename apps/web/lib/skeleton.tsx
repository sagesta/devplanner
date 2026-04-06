"use client";

import { cn } from "./utils";

export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "animate-shimmer rounded-md bg-white/[0.06]",
        className
      )}
      {...props}
    />
  );
}

export function SkeletonCard() {
  return (
    <div className="rounded-md border border-white/5 bg-background/90 p-3 space-y-2">
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-3 w-1/2" />
      <div className="flex gap-2 pt-1">
        <Skeleton className="h-4 w-12 rounded-full" />
        <Skeleton className="h-4 w-16 rounded-full" />
      </div>
    </div>
  );
}

export function SkeletonRow() {
  return (
    <tr className="border-b border-white/5">
      <td className="p-2">
        <Skeleton className="h-4 w-4" />
      </td>
      <td className="p-2">
        <Skeleton className="h-3 w-3 rounded-full" />
      </td>
      <td className="p-2">
        <Skeleton className="h-4 w-40" />
      </td>
      <td className="p-2">
        <Skeleton className="h-4 w-16" />
      </td>
      <td className="p-2">
        <Skeleton className="h-4 w-14" />
      </td>
      <td className="p-2">
        <Skeleton className="h-4 w-14" />
      </td>
      <td className="p-2">
        <Skeleton className="h-4 w-20" />
      </td>
      <td className="p-2">
        <Skeleton className="h-4 w-6 ml-auto" />
      </td>
    </tr>
  );
}

export function SkeletonListItem() {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-surface px-3 py-3">
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-3/5" />
        <Skeleton className="h-3 w-1/4" />
      </div>
      <Skeleton className="h-7 w-14 rounded" />
    </div>
  );
}
