"use client";

import { cn } from "@/lib/utils";

export interface LogoProps {
  size?: number;
  /** Show the wordmark next to the mark */
  showWordmark?: boolean;
  className?: string;
}

/**
 * Quickcrawl brand mark — a white rabbit.
 * Uses the bundled transparent PNG at /rabbit.png so the artwork is
 * pixel-perfect across navbar and favicon.
 */
export function Logo({ size = 48, showWordmark = false, className }: LogoProps) {
  // Scale wordmark text with the mark size so they stay visually balanced.
  const wordmarkClass =
    size >= 48
      ? "text-xl font-semibold"
      : size >= 36
        ? "text-base font-semibold"
        : "text-sm font-semibold";

  return (
    <div className={cn("inline-flex items-center gap-2.5", className)}>
      <Mark size={size} />
      {showWordmark && (
        <span className={cn("tracking-tight text-fg", wordmarkClass)}>
          Quickcrawl
        </span>
      )}
    </div>
  );
}

export function Mark({ size = 48, className }: { size?: number; className?: string }) {
  return (
    <img
      src="/rabbit.png"
      alt=""
      width={size}
      height={size}
      className={cn("shrink-0 select-none", className)}
      draggable={false}
    />
  );
}