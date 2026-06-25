"use client";

import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { UploadCloud } from "@/components/Icon";

export interface DropZoneProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  maxFileBytes?: number;
}

const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_FILES = 20;

export function DropZone({
  value,
  onChange,
  placeholder,
  maxLength,
  maxFileBytes = DEFAULT_MAX_FILE_BYTES,
}: DropZoneProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);

  const onFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      setWarning(null);
      const arr = Array.from(files).slice(0, DEFAULT_MAX_FILES);
      const parts: string[] = [];
      const skipped: string[] = [];
      for (const f of arr) {
        if (f.size > maxFileBytes) {
          skipped.push(`${f.name} (too large)`);
          continue;
        }
        try {
          const text = await f.text();
          parts.push(text);
        } catch (err) {
          skipped.push(`${f.name} (${err instanceof Error ? err.message : "read error"})`);
        }
      }
      const combined = (value ? value + "\n" : "") + parts.join("\n");
      const truncated = maxLength ? combined.slice(0, maxLength) : combined;
      onChange(truncated);
      if (skipped.length > 0) {
        setWarning(`Skipped: ${skipped.join(", ")}`);
      }
    },
    [value, onChange, maxLength, maxFileBytes],
  );

  return (
    <div className="space-y-1.5">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void onFiles(e.dataTransfer.files);
        }}
        className={cn(
          "relative overflow-hidden rounded-md border bg-surface transition-colors",
          dragOver
            ? "border-accent bg-accent-glow"
            : "border-border hover:border-border-strong",
        )}
      >
        <textarea
          id="urls"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={10}
          maxLength={maxLength}
          placeholder={
            placeholder ??
            "https://example.com/page-1\nhttps://example.com/page-2\n\nPaste URLs one per line, or drop a .txt / .csv file."
          }
          spellCheck={false}
          className="block w-full resize-y border-0 bg-transparent px-3.5 py-3 font-mono text-xs leading-relaxed text-fg placeholder:text-fg-faint focus:outline-none"
        />

        <div className="flex items-center justify-between gap-3 border-t border-border bg-bg-subtle px-3.5 py-1.5 text-[11px] text-fg-muted">
          <span className="flex items-center gap-1.5">
            <UploadCloud size={12} />
            <span className="font-numeric tabular-nums">
              {value.length.toLocaleString()} chars
            </span>
          </span>
          {warning ? (
            <span className="text-warn">{warning}</span>
          ) : null}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="rounded text-fg-muted transition-colors hover:text-fg"
          >
            Load file
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.csv,text/plain,text/csv"
            multiple
            className="hidden"
            onChange={(e) => void onFiles(e.target.files)}
          />
        </div>

        {dragOver && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-bg/85">
            <div className="rounded-md border border-accent bg-surface px-4 py-2 text-sm font-medium text-accent">
              Drop file to load URLs
            </div>
          </div>
        )}
      </div>

      {maxLength && value.length > maxLength * 0.9 && (
        <p className="text-xs text-warn">
          <span className="font-numeric tabular-nums">
            {value.length.toLocaleString()} / {maxLength.toLocaleString()}
          </span>{" "}
          chars
        </p>
      )}
    </div>
  );
}