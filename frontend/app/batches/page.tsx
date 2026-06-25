"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";

import type { Batch } from "@/lib/api";
import { StatusPill, jobStatusPresentation } from "@/components/StatusPill";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/Button";
import { ArrowRight } from "@/components/Icon";
import { fmtRelative, truncateMiddle } from "@/lib/utils";
import { getBatches, getTokens } from "@/lib/store";

function dayBucket(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 60 * 60 * 24) return "Today";
  if (diff < 60 * 60 * 24 * 2) return "Yesterday";
  if (diff < 60 * 60 * 24 * 7) return "This week";
  return "Earlier";
}

function groupBatches(items: Batch[]): Array<[string, Batch[]]> {
  const groups: Record<string, Batch[]> = {};
  for (const b of items) {
    const k = dayBucket(b.created_at);
    (groups[k] ??= []).push(b);
  }
  const order = ["Today", "Yesterday", "This week", "Earlier"];
  return order.filter((k) => groups[k]).map((k) => [k, groups[k]]);
}

export default function BatchesListPage() {
  const router = useRouter();
  const [batches, setBatches] = useState<Batch[] | null>(null);

  useEffect(() => {
    try {
      if (!getTokens()) {
        router.replace("/welcome");
        return;
      }
      setBatches(getBatches());
    } catch (e) {
      console.error("batches load failed:", e);
      setBatches([]);
    }
  }, [router]);

  if (!batches) return <div className="text-sm text-fg-muted">Loading…</div>;

  if (batches.length === 0) {
    return (
      <EmptyState
        title="No batches yet"
        description="Submit some URLs on the dashboard and they'll show up here as a timeline."
        cta={
          <Link href="/">
            <Button iconRight={<ArrowRight size={12} />}>Submit URLs</Button>
          </Link>
        }
      />
    );
  }

  const groups = groupBatches(batches);

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-fg-faint">
            History
          </p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-fg">
            Batches
          </h1>
        </div>
        <p className="text-[11px] text-fg-faint">
          {batches.length} batch{batches.length === 1 ? "" : "es"} in this browser
        </p>
      </div>

      <div className="space-y-8">
        {groups.map(([day, items]) => (
          <section key={day}>
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-fg-faint">
              {day}
              <span className="ml-1.5 font-normal text-fg-faint">
                · {items.length}
              </span>
            </h2>
            <motion.div
              initial="hidden"
              animate="visible"
              variants={{
                hidden: {},
                visible: {
                  transition: { staggerChildren: 0.04, delayChildren: 0.02 },
                },
              }}
              className="overflow-hidden rounded-lg border border-border"
            >
              {items.map((b, idx) => {
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
                  <motion.div
                    key={b.id}
                    variants={{
                      hidden: { opacity: 0, y: 4 },
                      visible: { opacity: 1, y: 0, transition: { duration: 0.2 } },
                    }}
                    className={idx > 0 ? "border-t border-border" : ""}
                  >
                    <Link
                      href={`/batches/detail?id=${b.id}`}
                      className="group flex items-center gap-4 px-4 py-2.5 transition-colors hover:bg-bg-subtle/60"
                    >
                      <span className="font-numeric text-xs tabular-nums text-fg-faint">
                        #{b.id}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm text-fg group-hover:text-accent">
                          {b.name || (
                            <span className="text-fg-muted">
                              {b.publish_type === "URL_DELETED"
                                ? "Remove batch"
                                : "Submit batch"}
                            </span>
                          )}
                        </div>
                        <div className="truncate font-mono text-[11px] text-fg-faint">
                          {truncateMiddle(b.property_url, 60)}
                        </div>
                      </div>
                      <span className="hidden font-numeric text-[11px] tabular-nums text-fg-muted sm:inline">
                        {b.total} urls
                      </span>
                      <StatusPill tone={pres.tone} pulse={pres.pulse}>
                        <span className="font-numeric tabular-nums">
                          {b.succeeded}/{b.total}
                        </span>
                        {b.failed > 0 && (
                          <span className="ml-1 text-err">
                            · {b.failed} fail
                          </span>
                        )}
                        {b.cancelled > 0 && (
                          <span className="ml-1 text-fg-faint">
                            · {b.cancelled} cancel
                          </span>
                        )}
                      </StatusPill>
                      <span className="hidden w-20 text-right text-[11px] text-fg-faint sm:inline">
                        {fmtRelative(b.created_at)}
                      </span>
                    </Link>
                  </motion.div>
                );
              })}
            </motion.div>
          </section>
        ))}
      </div>
    </div>
  );
}
