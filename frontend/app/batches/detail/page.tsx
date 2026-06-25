"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

import type { BatchDetail } from "@/lib/api";
import type { StoredJob } from "@/lib/store";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { StatusPill, jobStatusPresentation } from "@/components/StatusPill";
import { ProgressBar } from "@/components/ProgressBar";
import { Refresh } from "@/components/Icon";
import { fmtRelative, truncateMiddle, cn } from "@/lib/utils";
import {
  getBatches,
  getJobs,
  getTokens,
  setBatches,
  setJobs,
  type StoredBatch,
} from "@/lib/store";
import { GoogleAPIError, OAuthError, publishUrl } from "@/lib/google-client";

function isComplete(b: StoredBatch): boolean {
  return b.pending + b.processing === 0;
}

export default function BatchDetailPage() {
  return (
    <Suspense fallback={<div className="text-sm text-fg-muted">Loading…</div>}>
      <BatchDetailInner />
    </Suspense>
  );
}

function BatchDetailInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const idParam = searchParams.get("id");
  const id = idParam ?? "";
  const [batch, setBatch] = useState<BatchDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requeuing, setRequeuing] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState<"all" | "failed" | "pending">("all");

  const refresh = () => {
    if (!getTokens()) {
      router.replace("/welcome");
      return;
    }
    const batchId = Number(id);
    if (!Number.isFinite(batchId)) {
      setError("Missing or invalid batch id");
      return;
    }
    const b = getBatches().find((x) => x.id === batchId);
    if (!b) {
      setError("Batch not found");
      return;
    }
    const jobs = getJobs()
      .filter((j) => j.batch_id === batchId)
      .map((j) => ({
        id: j.id,
        batch_id: j.batch_id,
        url: j.url,
        property_url: j.property_url,
        publish_type: j.publish_type,
        status: j.status,
        attempts: j.attempts,
        last_error: j.last_error,
        http_status: j.http_status,
        google_notify_time: j.google_notify_time,
        created_at: j.created_at,
        submitted_at: j.submitted_at,
        completed_at: j.completed_at,
      }))
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    setBatch({ ...b, jobs });
    setError(null);
  };

  useEffect(() => {
    refresh();
  }, [id]);

  const onRequeue = async (jobId: number) => {
    setRequeuing((prev) => new Set(prev).add(jobId));
    try {
      const updatedJobs: StoredJob[] = getJobs().map((j) =>
        j.id === jobId && j.status === "failed"
          ? { ...j, status: "pending" as const, attempts: 0, last_error: null }
          : j,
      );
      const updatedBatches = getBatches().map((b) =>
        b.id === batch?.id ? { ...b, failed: Math.max(b.failed - 1, 0), pending: b.pending + 1 } : b,
      );
      setJobs(updatedJobs);
      setBatches(updatedBatches);
      refresh();

      const job = updatedJobs.find((j) => j.id === jobId);
      if (!job) return;
      const processingJobs: StoredJob[] = getJobs().map((j): StoredJob =>
        j.id === jobId ? { ...j, status: "processing", attempts: 1 } : j,
      );
      const processingBatches = getBatches().map((b) =>
        b.id === batch?.id
          ? { ...b, pending: Math.max(b.pending - 1, 0), processing: b.processing + 1 }
          : b,
      );
      setJobs(processingJobs);
      setBatches(processingBatches);
      try {
        const resp = await publishUrl(job.url, job.publish_type);
        const notify = resp.urlNotificationMetadata?.latestUpdate?.notifyTime ?? null;
        const okJobs = getJobs().map((j) =>
          j.id === jobId
            ? {
                ...j,
                status: "submitted" as const,
                http_status: 200,
                submitted_at: new Date().toISOString(),
                completed_at: new Date().toISOString(),
                last_error: null,
                google_notify_time: notify,
              }
            : j,
        );
        const okBatches = getBatches().map((b) =>
          b.id === batch?.id
            ? { ...b, processing: Math.max(b.processing - 1, 0), succeeded: b.succeeded + 1 }
            : b,
        );
        setJobs(okJobs);
        setBatches(okBatches);
      } catch (e) {
        const code = e instanceof GoogleAPIError ? e.statusCode : 0;
        const msg = e instanceof GoogleAPIError ? e.apiMessage : e instanceof Error ? e.message : String(e);
        const failedJobs = getJobs().map((j) =>
          j.id === jobId
            ? {
                ...j,
                status: "failed" as const,
                http_status: code,
                last_error: `${code}: ${String(msg).split("\n")[0].slice(0, 280)}`,
                completed_at: new Date().toISOString(),
              }
            : j,
        );
        const failedBatches = getBatches().map((b) =>
          b.id === batch?.id
            ? { ...b, processing: Math.max(b.processing - 1, 0), failed: b.failed + 1 }
            : b,
        );
        setJobs(failedJobs);
        setBatches(failedBatches);
        if (e instanceof OAuthError) {
          router.replace("/welcome");
        }
      }
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRequeuing((prev) => {
        const next = new Set(prev);
        next.delete(jobId);
        return next;
      });
    }
  };

  if (error && !batch) {
    return (
      <div className="rounded-lg border border-err/40 bg-err/[0.04] p-4 text-sm text-err">
        {error}
      </div>
    );
  }
  if (!batch) return <div className="text-sm text-fg-muted">Loading…</div>;

  const complete = isComplete(batch);
  const total = batch.total;
  const done = batch.succeeded + batch.failed + batch.cancelled;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  const jobs = batch.jobs.filter((j) =>
    filter === "all"
      ? true
      : filter === "failed"
        ? j.status === "failed"
        : j.status === "pending" || j.status === "processing",
  );

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/batches"
          className="inline-flex items-center gap-1 text-xs text-fg-muted transition-colors hover:text-fg"
        >
          ← Batches
        </Link>
      </div>

      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-fg-faint">
            <span className="font-numeric tabular-nums">#{batch.id}</span>
            <span>·</span>
            <span>{batch.publish_type}</span>
            <span>·</span>
            <span>{fmtRelative(batch.created_at)}</span>
          </div>
          <h1 className="mt-1 truncate text-xl font-semibold tracking-tight text-fg">
            {batch.name || `Batch #${batch.id}`}
          </h1>
          <p className="mt-0.5 truncate font-mono text-xs text-fg-muted">
            {batch.property_url}
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => refresh()} icon={<Refresh size={12} />}>
          Refresh
        </Button>
      </header>

      <Card padding="md">
        <div className="space-y-3">
          <div className="flex items-baseline justify-between">
            <div>
              <div className="font-numeric text-2xl font-semibold tabular-nums text-fg">{pct}%</div>
              <div className="text-[11px] text-fg-muted">
                {complete ? "Complete" : "In progress"} · {done} of {total} settled
              </div>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-fg-muted">
              <span>
                <span className="font-numeric tabular-nums text-ok">{batch.succeeded}</span> ok
              </span>
              <span>
                <span className="font-numeric tabular-nums text-err">{batch.failed}</span> failed
              </span>
              <span>
                <span className="font-numeric tabular-nums text-warn">{batch.pending}</span> pending
              </span>
            </div>
          </div>
          <ProgressBar value={done} max={total || 1} tone={complete ? "ok" : "info"} size="md" />
        </div>
      </Card>

      {error && (
        <div className="rounded-md border border-warn/40 bg-warn/[0.04] px-3.5 py-2 text-sm text-warn">
          {error}
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center gap-1">
          {(["all", "pending", "failed"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                filter === f ? "bg-surface text-fg" : "text-fg-muted hover:text-fg",
              )}
            >
              {f}
              {f === "failed" && batch.failed > 0 && (
                <span className="ml-1.5 font-numeric tabular-nums text-err">{batch.failed}</span>
              )}
              {f === "pending" && batch.pending + batch.processing > 0 && (
                <span className="ml-1.5 font-numeric tabular-nums text-warn">
                  {batch.pending + batch.processing}
                </span>
              )}
            </button>
          ))}
          <span className="ml-auto text-[11px] text-fg-faint">
            {jobs.length} of {batch.jobs.length} jobs
          </span>
        </div>

        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-lo text-[11px] uppercase tracking-wider text-fg-faint">
              <tr>
                <th className="px-3.5 py-2 text-left font-medium">URL</th>
                <th className="px-3.5 py-2 text-left font-medium">Status</th>
                <th className="px-3.5 py-2 text-right font-medium">Tries</th>
                <th className="px-3.5 py-2 text-left font-medium">Error</th>
                <th className="px-3.5 py-2 text-right font-medium">Submitted</th>
                <th className="px-3.5 py-2 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {jobs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3.5 py-6 text-center text-xs text-fg-muted">
                    No jobs match this filter.
                  </td>
                </tr>
              ) : (
                jobs.map((j) => {
                  const pres = jobStatusPresentation(j.status);
                  const inFlight = requeuing.has(j.id);
                  return (
                    <tr
                      key={j.id}
                      className="border-t border-border transition-colors hover:bg-bg-subtle/50"
                    >
                      <td className="max-w-md truncate px-3.5 py-2 font-mono text-xs text-fg">
                        {truncateMiddle(j.url, 80)}
                      </td>
                      <td className="px-3.5 py-2">
                        <StatusPill tone={pres.tone} pulse={pres.pulse}>
                          {j.status}
                        </StatusPill>
                      </td>
                      <td className="px-3.5 py-2 text-right font-numeric tabular-nums text-xs text-fg-muted">
                        {j.attempts}
                      </td>
                      <td className="max-w-xs truncate px-3.5 py-2 text-xs text-fg-muted">
                        {j.last_error ?? "—"}
                      </td>
                      <td className="px-3.5 py-2 text-right text-[11px] text-fg-faint">
                        {fmtRelative(j.submitted_at)}
                      </td>
                      <td className="px-3.5 py-2 text-right">
                        {j.status === "failed" && (
                          <Button
                            variant="secondary"
                            size="sm"
                            loading={inFlight}
                            disabled={inFlight}
                            onClick={() => void onRequeue(j.id)}
                          >
                            {inFlight ? "…" : "Retry"}
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
