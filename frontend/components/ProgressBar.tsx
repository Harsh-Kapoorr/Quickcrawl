"use client";

import { cn } from "@/lib/utils";

interface ProgressBarProps {
  value: number;
  max?: number;
  tone?: "ok" | "warn" | "err" | "info";
  size?: "sm" | "md";
  className?: string;
  label?: string;
}

const toneClasses: Record<NonNullable<ProgressBarProps["tone"]>, string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  err: "bg-err",
  info: "bg-info",
};

export function ProgressBar({
  value,
  max = 100,
  tone = "info",
  size = "md",
  className,
  label,
}: ProgressBarProps) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const heightClass = size === "sm" ? "h-1" : "h-1.5";

  return (
    <div className={className}>
      {label && (
        <div className="mb-1.5 flex items-baseline justify-between text-xs text-fg-muted">
          <span>{label}</span>
          <span className="font-numeric tabular-nums text-fg">
            {Math.round(pct)}%
          </span>
        </div>
      )}
      <div
        className={cn(
          "w-full overflow-hidden rounded-full bg-bg-subtle",
          heightClass,
        )}
      >
        <div
          className={cn("h-full rounded-full", toneClasses[tone])}
          style={{
            width: `${pct}%`,
            transition: "width 300ms ease-out",
          }}
        />
      </div>
    </div>
  );
}