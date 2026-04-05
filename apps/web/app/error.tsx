"use client";

import { useEffect } from "react";
import { AlertCircle } from "lucide-react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center p-4">
      <AlertCircle size={48} className="mb-4 text-red-500/80" />
      <h2 className="mb-2 font-display text-xl text-foreground">Something went wrong</h2>
      <p className="mb-6 text-sm text-muted">{error.message || "An unexpected error occurred."}</p>
      <button
        onClick={() => reset()}
        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover transition-colors"
      >
        Try again
      </button>
    </div>
  );
}
