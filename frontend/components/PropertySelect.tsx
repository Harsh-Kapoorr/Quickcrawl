"use client";

import { useState } from "react";

import { Button } from "@/components/Button";
import { Refresh } from "@/components/Icon";
import { cn } from "@/lib/utils";
import type { Property } from "@/lib/api";

export interface PropertySelectProps {
  properties: Property[];
  value: string;
  onChange: (value: string) => void;
  propertiesError?: string | null;
  onReload?: () => Promise<void> | void;
}

export function PropertySelect({
  properties,
  value,
  onChange,
  propertiesError,
  onReload,
}: PropertySelectProps) {
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const onSync = async () => {
    if (!onReload) return;
    setSyncing(true);
    setSyncMsg(null);
    try {
      await onReload();
      setSyncMsg("Synced from Google.");
    } catch (e) {
      setSyncMsg(`Sync failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSyncing(false);
    }
  };

  if (propertiesError && properties.length === 0) {
    return (
      <div className="rounded-lg border border-err/40 bg-err/[0.04] p-3">
        <div className="text-xs font-medium text-err">Could not load properties</div>
        <div className="mt-0.5 text-xs text-fg-muted">{propertiesError}</div>
        <Button
          variant="secondary"
          size="sm"
          loading={syncing}
          onClick={onSync}
          className="mt-2"
        >
          Retry sync
        </Button>
        {syncMsg && <div className="mt-1.5 text-xs text-fg-muted">{syncMsg}</div>}
      </div>
    );
  }

  if (properties.length === 0) {
    return (
      <div className="rounded-lg border border-warn/40 bg-warn/[0.04] p-3">
        <div className="text-xs font-medium text-warn">No verified properties yet</div>
        <div className="mt-0.5 text-xs text-fg-muted">
          Sync from Google to fetch your Search Console sites. Your Google account
          must be an <span className="font-medium text-fg">owner</span> of each
          property.
        </div>
        <Button
          variant="secondary"
          size="sm"
          loading={syncing}
          onClick={onSync}
          className="mt-2"
        >
          Sync from Google
        </Button>
        {syncMsg && <div className="mt-1.5 text-xs text-fg-muted">{syncMsg}</div>}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <label htmlFor="property" className="text-xs font-medium text-fg-muted">
          Property
        </label>
        <button
          type="button"
          disabled={syncing}
          onClick={onSync}
          className="inline-flex items-center gap-1 text-xs text-fg-muted transition-colors hover:text-fg disabled:opacity-50"
        >
          <span className={syncing ? "animate-spin-slow" : ""}>
            <Refresh size={12} />
          </span>
          {syncing ? "Syncing…" : "Resync"}
        </button>
      </div>
      <select
        id="property"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "w-full appearance-none rounded-md border border-border bg-surface px-3 py-2 pr-9 font-mono text-xs",
          "transition-colors hover:border-border-strong focus:border-accent focus:outline-none",
          "bg-[url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2216%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%238E939B%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22m6 9 6 6 6-6%22/%3E%3C/svg%3E')] bg-[length:16px_16px] bg-[position:right_10px_center] bg-no-repeat",
        )}
      >
        {properties.map((p) => (
          <option key={p.site_url} value={p.site_url}>
            {p.site_url}  ·  {p.permission_level}
          </option>
        ))}
      </select>
      {syncMsg && <div className="text-xs text-fg-muted">{syncMsg}</div>}
    </div>
  );
}
