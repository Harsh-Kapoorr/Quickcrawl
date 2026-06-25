"use client";

import type { ReactNode } from "react";
import { Inbox } from "@/components/Icon";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  cta?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

export function EmptyState({
  title,
  description,
  cta,
  icon,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-surface/50 px-6 py-10 text-center",
        className,
      )}
    >
      <div className="text-fg-faint">
        {icon ?? <Inbox size={20} />}
      </div>
      <div className="space-y-1">
        <h2 className="text-sm font-medium text-fg">{title}</h2>
        {description && (
          <p className="mx-auto max-w-sm text-xs text-fg-muted">{description}</p>
        )}
      </div>
      {cta && <div className="pt-1">{cta}</div>}
    </div>
  );
}