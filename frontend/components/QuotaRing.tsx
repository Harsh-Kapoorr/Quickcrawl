"use client";

import { cn } from "@/lib/utils";

interface QuotaRingProps {
  used: number;
  limit: number;
  size?: number;
  className?: string;
}

/**
 * Minimal SVG ring: track + accent stroke + tabular count.
 * No gradients, no motion — Linear-style.
 */
export function QuotaRing({ used, limit, size = 96, className }: QuotaRingProps) {
  const stroke = 6;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const C = 2 * Math.PI * r;
  const pct = limit > 0 ? Math.min(1, used / limit) : 0;
  const dashOffset = C * (1 - pct);
  const danger = limit > 0 && used / limit >= 0.9;

  return (
    <div
      className={cn("relative inline-flex items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={cx}
          cy={cy}
          r={r}
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={stroke}
          fill="none"
        />
        <circle
          cx={cx}
          cy={cy}
          r={r}
          stroke={danger ? "#E2B341" : "#7C5CF0"}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={dashOffset}
          style={{ transition: "stroke-dashoffset 300ms ease-out" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-numeric text-xl font-semibold tabular-nums text-fg">
          {used}
        </span>
        <span className="font-numeric text-[10px] text-fg-muted">
          / {limit}
        </span>
      </div>
    </div>
  );
}