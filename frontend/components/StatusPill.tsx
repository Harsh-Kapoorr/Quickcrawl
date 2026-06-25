"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type StatusTone =
  | "neutral"
  | "ok"
  | "warn"
  | "err"
  | "info"
  | "pending"
  | "processing"
  | "submitted"
  | "failed"
  | "cancelled";

const dotClasses: Record<StatusTone, string> = {
  neutral: "bg-fg-faint",
  ok: "bg-ok",
  warn: "bg-warn",
  err: "bg-err",
  info: "bg-info",
  pending: "bg-warn",
  processing: "bg-info",
  submitted: "bg-ok",
  failed: "bg-err",
  cancelled: "bg-fg-faint",
};

interface StatusPillProps {
  tone?: StatusTone;
  pulse?: boolean;
  children: ReactNode;
  className?: string;
}

export function StatusPill({
  tone = "neutral",
  pulse = false,
  children,
  className,
}: StatusPillProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium text-fg-muted",
        className,
      )}
    >
      <span
        className={cn(
          "inline-block h-1.5 w-1.5 rounded-full",
          dotClasses[tone],
          pulse && "animate-pulse-soft",
        )}
      />
      {children}
    </span>
  );
}

/** Returns the right tone + pulse config for a Job.status value. */
export function jobStatusPresentation(status: string): {
  tone: StatusTone;
  pulse: boolean;
} {
  switch (status) {
    case "pending":
      return { tone: "pending", pulse: false };
    case "processing":
      return { tone: "processing", pulse: true };
    case "submitted":
      return { tone: "submitted", pulse: false };
    case "failed":
      return { tone: "failed", pulse: false };
    case "cancelled":
      return { tone: "cancelled", pulse: false };
    default:
      return { tone: "neutral", pulse: false };
  }
}