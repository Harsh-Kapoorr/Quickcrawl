"use client";

import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  hover?: boolean;
  padding?: "none" | "sm" | "md" | "lg";
  /** Show a subtle top edge highlight (for elevated panels) */
  elevated?: boolean;
  children?: ReactNode;
}

const paddingClasses = {
  none: "",
  sm: "p-4",
  md: "p-5",
  lg: "p-6",
};

export function Card({
  className,
  hover = false,
  padding = "md",
  elevated = false,
  children,
  ...rest
}: CardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-surface",
        elevated && "edge-top",
        hover && "transition-colors hover:border-border-strong hover:bg-surface-hi",
        paddingClasses[padding],
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-4 flex items-baseline justify-between gap-3", className)}>
      {children}
    </div>
  );
}

export function CardTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h3 className={cn("text-sm font-semibold tracking-tight text-fg", className)}>
      {children}
    </h3>
  );
}

export function CardDescription({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("text-sm text-fg-muted", className)}>{children}</p>
  );
}