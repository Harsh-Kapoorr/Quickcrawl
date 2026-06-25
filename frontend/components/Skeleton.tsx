"use client";

import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded bg-bg-subtle",
        "after:absolute after:inset-0",
        "after:bg-gradient-to-r after:from-transparent after:via-white/[0.04] after:to-transparent",
        "after:animate-[fade-in_1.4s_ease-in-out_infinite]",
        className,
      )}
      aria-hidden="true"
    />
  );
}