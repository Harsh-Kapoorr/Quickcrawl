"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";

import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { StatusPill, jobStatusPresentation } from "@/components/StatusPill";
import { DropZone } from "@/components/DropZone";
import { PropertySelect } from "@/components/PropertySelect";
import { QuotaRing } from "@/components/QuotaRing";
import { ArrowRight } from "@/components/Icon";
import { fmtTime, isLikelyUrl, parseUrlInput, propertyMatchesUrl } from "@/lib/utils";
import type { Batch, Job, Property, Quota } from "@/lib/api";
import {
  bumpQuota,
  getBatches,
  getJobs,
  getProperties,
  getQuota,
  getTokens,
  setBatches,
  setJobs,
  setProperties,
  type StoredBatch,
  type StoredJob,
} from "@/lib/store";
import { GoogleAPIError, OAuthError, listSites, publishUrl } from "@/lib/google-client";

const MAX_URL_CHARS = 200_000;
const DAILY_QUOTA = 200;
const MIN_REQUEST_INTERVAL_MS = 1100;

export default function DashboardPage() {
  const router = useRouter();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [properties, setProps] = useState<Property[]>([]);
  const [quota, setQ] = useState<Quota>({ date: "", used: 0, limit: DAILY_QUOTA, remaining: DAILY_QUOTA });
  const [recentBatches, setRecentBatches] = useState<StoredBatch[]>([]);
  const [selectedProperty, setSelectedProperty] = useState<string>("");
  const [urls, setUrls] = useState<string>("");
  const [batchName, setBatchName] = useState<string>("");
  const [publishType, setPublishType] = useState<"URL_UPDATED" | "URL_DELETED">("URL_UPDATED");
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dedupWarning, setDedupWarning] = useState<
    Array<{ url: string; property_url: string; last_submitted_at: string | null; last_seen_at: string }> | null
  >(null);
  const [propertiesError, setPropertiesError] = useState<string | null>(null);

  const selectedRef = useRef(selectedProperty);
  selectedRef.current = selectedProperty;

  const refresh = useCallback(async () => {
    const tokens = getTokens();
    if (!tokens) {
      router.replace("/welcome");
      return;
    }
    setAuthed(true);
    setProps(getProperties());
    setQ({ date: getQuota().date, used: getQuota().count, limit: DAILY_QUOTA, remaining: Math.max(DAILY_QUOTA - getQuota().count, 0) });
    setRecentBatches(getBatches().slice(0, 5));
    if (!selectedRef.current && getProperties().length > 0) {
      setSelectedProperty(getProperties()[0].site_url);
    }
  }, [router]);

  useEffect(() => {
    refresh().catch((e) => {
      // Never leave the page stuck on "Loading…" — mark as unauthed and
      // route back to /welcome on any unexpected refresh failure.
      console.error("dashboard refresh failed:", e);
      setAuthed(false);
      router.replace("/welcome");
    });
  }, [refresh, router]);

  const onSync = async () => {
    setPropertiesError(null);
    try {
      const sites = await listSites();
      const now = new Date().toISOString();
      const mapped: Property[] = sites.map((s) => ({
        site_url: s.siteUrl,
        permission_level: s.permissionLevel ?? "siteOwner",
        last_synced: now,
      }));
      setProperties(mapped);
      await refresh();
    } catch (e) {
      if (e instanceof OAuthError) {
        router.replace("/welcome");
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      setPropertiesError(`Sync failed: ${msg}`);
    }
  };

  const onSubmit = useCallback(async () => {
    setError(null);
    setDedupWarning(null);

    const list = parseUrlInput(urls).filter(isLikelyUrl);
    if (list.length === 0) {
      setError("Add at least one valid URL (must start with http:// or https://)");
      return;
    }
    if (!selectedProperty) {
      setError("Select a property first");
      return;
    }
    // Gate submission on remaining quota so we don't waste 429 retries on
    // Google when we already know the day is exhausted.
    const remaining = Math.max(DAILY_QUOTA - getQuota().count, 0);
    if (remaining <= 0) {
      setError("Daily quota exhausted. Try again after UTC midnight.");
      return;
    }
    if (list.length > remaining) {
      setError(`Only ${remaining} submission${remaining === 1 ? "" : "s"} left today — trim your list to ${remaining} URL${remaining === 1 ? "" : "s"}.`);
      return;
    }

    // Soft dedup check
    const existingJobs = getJobs();
    const recent = existingJobs
      .filter(
        (j) =>
          j.property_url === selectedProperty &&
          (j.status === "submitted" || j.status === "pending") &&
          list.includes(j.url) &&
          Date.now() - new Date(j.created_at).getTime() < 60 * 60 * 1000,
      )
      .map((j) => ({
        url: j.url,
        property_url: j.property_url,
        last_submitted_at: j.submitted_at,
        last_seen_at: j.created_at,
      }));
    if (recent.length > 0) setDedupWarning(recent);

    const batchId = Date.now();
    const now = new Date().toISOString();
    const newBatch: StoredBatch = {
      id: batchId,
      name: batchName.trim() || null,
      property_url: selectedProperty,
      publish_type: publishType,
      total: list.length,
      pending: list.length,
      processing: 0,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
      created_at: now,
    };
    const newJobs: StoredJob[] = list.map((url, i) => ({
      id: batchId * 1000 + i,
      batch_id: batchId,
      url,
      property_url: selectedProperty,
      publish_type: publishType,
      status: "pending",
      attempts: 0,
      last_error: null,
      http_status: null,
      google_notify_time: null,
      created_at: now,
      submitted_at: null,
      completed_at: null,
    }));
    setBatches([newBatch, ...getBatches()]);
    setJobs([...newJobs, ...existingJobs]);

    setUrls("");
    setBatchName("");
    setSubmitting(true);
    setProgress({ done: 0, total: list.length });

    // Submit one by one with rate limiting.
    let done = 0;
    let succeeded = 0;
    let failed = 0;
    const updatedJobs: StoredJob[] = [...newJobs];
    for (let i = 0; i < list.length; i++) {
      const url = list[i];
      const j = updatedJobs[i];
      j.status = "processing";
      j.attempts += 1;
      setJobs(updatedJobs);

      try {
        const resp = await publishUrl(url, publishType);
        const notify = resp.urlNotificationMetadata?.latestUpdate?.notifyTime ?? null;
        j.status = "submitted";
        j.http_status = 200;
        j.submitted_at = new Date().toISOString();
        j.completed_at = j.submitted_at;
        j.last_error = null;
        j.google_notify_time = notify;
        succeeded++;
      } catch (e) {
        j.status = "failed";
        j.completed_at = new Date().toISOString();
        j.http_status = e instanceof GoogleAPIError ? e.statusCode : null;
        const msg =
          e instanceof GoogleAPIError
            ? e.apiMessage
            : e instanceof Error
              ? e.message
              : String(e);
        j.last_error = `${j.http_status ?? "?"}: ${String(msg).split("\n")[0].slice(0, 280)}`;
        failed++;
        if (e instanceof OAuthError) {
          setError("Re-auth required. Please sign in again.");
          router.replace("/welcome");
          break;
        }
      }

      updatedJobs[i] = j;
      setJobs(updatedJobs);

      // Update quota (we only count successful ones; publishUrl also bumps but
      // we already counted in publishUrl for success. Recompute from quota
      // table to keep it accurate.)
      setQ({ date: getQuota().date, used: getQuota().count, limit: DAILY_QUOTA, remaining: Math.max(DAILY_QUOTA - getQuota().count, 0) });

      done++;
      setProgress({ done, total: list.length });

      // Throttle
      if (i < list.length - 1) await sleep(MIN_REQUEST_INTERVAL_MS);
    }

    // Final batch counters
    const finalBatches = getBatches().map((b) =>
      b.id === batchId
        ? {
            ...b,
            pending: 0,
            processing: 0,
            succeeded,
            failed,
          }
        : b,
    );
    setBatches(finalBatches);
    setRecentBatches(finalBatches.slice(0, 5));

    setSubmitting(false);
    setProgress(null);
    if (failed === 0 && succeeded > 0) {
      router.push(`/batches/detail?id=${batchId}`);
    } else if (succeeded + failed > 0) {
      router.push(`/batches/detail?id=${batchId}`);
    }
  }, [urls, batchName, publishType, selectedProperty, router]);

  if (authed === null) {
    return <div className="py-16 text-center text-fg-muted">Loading…</div>;
  }
  if (!authed) return null;

  const parsed = parseUrlInput(urls).filter(isLikelyUrl);
  const parsedCount = parsed.length;
  const overLimit = urls.length > MAX_URL_CHARS;

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={containerVariants}
      className="space-y-8"
    >
      {/* Hero band */}
      <motion.section
        variants={staggerItem}
        className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-center"
      >
        <div className="space-y-2">
          <p className="text-sm font-medium uppercase tracking-wider text-fg-muted">
            Submit URLs
          </p>
          <h1 className="font-display text-4xl font-medium leading-[1.05] tracking-tight text-fg">
            Drop URLs in.
            <br />
            <span className="bg-gradient-flame bg-clip-text italic text-transparent">
              Crawler handles the rest.
            </span>
          </h1>
          <p className="max-w-xl text-base text-fg-muted">
            Each URL is checked against your verified Search Console property,
            then submitted to Google&apos;s Indexing API at a safe rate so your
            quota lasts.
          </p>
        </div>
        <div className="flex justify-center lg:justify-end">
          <QuotaRing used={quota.used} limit={quota.limit} size={180} />
        </div>
      </motion.section>

      {/* Main + Sidebar */}
      <div className="grid gap-6 lg:grid-cols-3">
        <motion.section variants={staggerItem} className="space-y-5 lg:col-span-2">
          <Card padding="lg">
            <div className="space-y-5">
              <PropertySelect
                properties={properties}
                propertiesError={propertiesError}
                value={selectedProperty}
                onChange={setSelectedProperty}
                onReload={onSync}
              />

              <div className="grid gap-5 sm:grid-cols-[1fr_auto] sm:items-end">
                <div className="space-y-1.5">
                  <label
                    htmlFor="batch-name"
                    className="block text-xs font-medium uppercase tracking-wider text-fg-muted"
                  >
                    Batch name (optional)
                  </label>
                  <input
                    id="batch-name"
                    type="text"
                    maxLength={200}
                    value={batchName}
                    onChange={(e) => setBatchName(e.target.value)}
                    placeholder="e.g. Q2 product launches"
                    className="w-full rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm transition-all hover:border-border-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                  />
                </div>
                <div className="space-y-1.5">
                  <label
                    htmlFor="publish-type"
                    className="block text-xs font-medium uppercase tracking-wider text-fg-muted"
                  >
                    Action
                  </label>
                  <div className="inline-flex rounded-xl border border-border bg-surface p-0.5">
                    {(["URL_UPDATED", "URL_DELETED"] as const).map((t) => {
                      const active = publishType === t;
                      return (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setPublishType(t)}
                          className={cn(
                            "rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
                            active
                              ? "bg-gradient-flame text-white shadow-sm"
                              : "text-fg-muted hover:text-fg",
                          )}
                        >
                          {t === "URL_UPDATED" ? "Submit" : "Remove"}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-baseline justify-between">
                  <label
                    htmlFor="urls"
                    className="block text-xs font-medium uppercase tracking-wider text-fg-muted"
                  >
                    URLs
                  </label>
                  <span className="font-numeric text-xs tabular-nums text-fg-muted">
                    {parsedCount} valid · {parseUrlInput(urls).length} parsed
                  </span>
                </div>
                <DropZone
                  value={urls}
                  onChange={(v) => setUrls(v.slice(0, MAX_URL_CHARS))}
                  maxLength={MAX_URL_CHARS}
                />
              </div>
            </div>
          </Card>

          {progress && (
            <div className="rounded-xl border border-border bg-bg-subtle/40 px-4 py-3 text-sm">
              <div className="mb-1.5 flex justify-between text-fg-muted">
                <span>Submitting…</span>
                <span className="font-numeric tabular-nums">
                  {progress.done} / {progress.total}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-border">
                <div
                  className="h-full bg-gradient-flame transition-all"
                  style={{ width: `${(progress.done / progress.total) * 100}%` }}
                />
              </div>
            </div>
          )}

          {error && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-xl border border-err/40 bg-err/5 px-4 py-3 text-sm text-err"
            >
              {error}
            </motion.div>
          )}

          {dedupWarning && dedupWarning.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-xl border border-warm/40 bg-warm/5 px-4 py-3 text-sm"
            >
              <div className="flex items-baseline justify-between">
                <div className="font-medium text-warm">
                  {dedupWarning.length === 1
                    ? "1 URL was recently submitted"
                    : `${dedupWarning.length} URLs were recently submitted`}
                </div>
                <button
                  type="button"
                  onClick={() => setDedupWarning(null)}
                  className="text-xs text-fg-muted hover:text-fg"
                >
                  Dismiss
                </button>
              </div>
              <div className="mt-1 text-fg-muted">
                Already submitted in the past hour — Google already has these.
              </div>
            </motion.div>
          )}

          <div className="flex items-center justify-between border-t border-border pt-4">
            <div className="text-sm text-fg-muted">
              Will submit{" "}
              <span className="font-numeric font-semibold tabular-nums text-fg">
                {parsedCount}
              </span>{" "}
              URL{parsedCount === 1 ? "" : "s"} to{" "}
              <span className="font-mono text-fg">{selectedProperty || "—"}</span>
            </div>
            <Button
              variant="primary"
              size="lg"
              loading={submitting}
              disabled={parsedCount === 0 || !selectedProperty || overLimit}
              onClick={() => void onSubmit()}
              iconRight={<ArrowRight size={16} />}
            >
              {submitting && progress
                ? `Submitting ${progress.done}/${progress.total}…`
                : `Submit ${parsedCount}`}
            </Button>
          </div>
        </motion.section>

        {/* Sidebar */}
        <motion.aside variants={staggerItem} className="space-y-5">
          <Card padding="md">
            <header className="mb-3 flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-fg">Recent activity</h2>
              <Link
                href="/batches"
                className="text-xs text-fg-muted hover:text-fg"
              >
                All →
              </Link>
            </header>

            {recentBatches.length === 0 ? (
              <p className="py-2 text-xs text-fg-muted">
                Nothing here yet — submit something to get started.
              </p>
            ) : (
              <ol className="space-y-2.5">
                {recentBatches.slice(0, 5).map((b) => {
                  const pres = jobStatusPresentation(
                    b.pending + b.processing > 0
                      ? "processing"
                      : b.failed > 0
                        ? "failed"
                        : b.succeeded === b.total
                          ? "submitted"
                          : "pending",
                  );
                  return (
                    <li key={b.id}>
                      <Link
                        href={`/batches/detail?id=${b.id}`}
                        className="group flex items-center justify-between gap-3 rounded-lg p-2 transition-colors hover:bg-bg-subtle"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-fg group-hover:text-accent">
                            {b.name || `Batch #${b.id}`}
                          </div>
                          <div className="truncate font-mono text-xs text-fg-faint">
                            {b.property_url}
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <StatusPill tone={pres.tone} pulse={pres.pulse}>
                            {b.succeeded}/{b.total}
                          </StatusPill>
                          <span className="text-xs text-fg-faint">
                            {fmtTime(b.created_at)}
                          </span>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ol>
            )}
          </Card>

          <Card padding="md">
            <h2 className="mb-2 text-sm font-semibold text-fg">How it works</h2>
            <ol className="space-y-2 text-xs leading-relaxed text-fg-muted">
              <li>
                <span className="font-mono text-fg">1.</span> URLs are validated
                against your verified Search Console properties.
              </li>
              <li>
                <span className="font-mono text-fg">2.</span> Crawler submits them
                to Google at 1 req/sec, capped at your daily quota.
              </li>
              <li>
                <span className="font-mono text-fg">3.</span> Failures are
                recorded on the job — re-queue from the batch detail page.
              </li>
              <li>
                <span className="font-mono text-fg">4.</span> Everything is stored
                in your browser — no server.
              </li>
            </ol>
          </Card>
        </motion.aside>
      </div>
    </motion.div>
  );
}

const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06, delayChildren: 0.05 } },
};

const staggerItem = {
  variants: { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.35 } } },
};

function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
