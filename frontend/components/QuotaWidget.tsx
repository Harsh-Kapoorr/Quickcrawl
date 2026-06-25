"use client";

import { cn } from "@/lib/utils";
import type { Quota } from "@/lib/api";

export function QuotaWidget({ quota }: { quota: Quota | null }) {
  if (!quota) {
    return <span className="text-xs text-fg-muted">quota: —</span>;
  }
  const pct =
    quota.limit > 0 ? Math.min(100, Math.round((quota.used / quota.limit) * 100)) : 0;
  const danger = quota.limit > 0 && quota.remaining < quota.limit * 0.1;
  return (
    <div className="flex items-center gap-2.5 text-xs">
      <span className="text-fg-muted">Today</span>
      <span
        className={cn(
          "font-numeric tabular-nums",
          danger ? "text-warn" : "text-fg",
        )}
      >
        {quota.used} / {quota.limit}
      </span>
      <div className="h-1 w-16 overflow-hidden rounded-full bg-bg-subtle">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-300",
            danger ? "bg-warn" : "bg-accent",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}