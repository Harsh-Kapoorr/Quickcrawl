"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";

import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { StatusPill } from "@/components/StatusPill";
import { Search, ArrowRight } from "@/components/Icon";
import { getProperties, getTokens } from "@/lib/store";
import { GoogleAPIError, OAuthError, inspectUrl } from "@/lib/google-client";
import { propertyMatchesUrl } from "@/lib/utils";

interface InspectResult {
  url: string;
  property_url: string;
  indexed: boolean;
  raw: {
    indexStatusResult?: {
      verdict?: string;
      coverageState?: string;
      robotsTxtState?: string;
      indexingState?: string;
      lastCrawlTime?: string;
      pageFetchState?: string;
    };
  };
}

export default function InspectPage() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<InspectResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getTokens()) router.replace("/welcome");
  }, [router]);

  const onSubmit = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const target = url.trim();
      const props = getProperties();
      const match = props.find((p) => propertyMatchesUrl(p.site_url, target));
      if (!match) {
        setError("URL does not match any synced property. Sync properties from the dashboard first.");
        setLoading(false);
        return;
      }
      const r = await inspectUrl(match.site_url, target);
      const inspection = (r.inspectionResult ?? {}) as InspectResult["raw"];
      const statusResult = inspection.indexStatusResult;
      setResult({
        url: target,
        property_url: match.site_url,
        indexed: statusResult?.verdict === "PASS",
        raw: inspection,
      });
    } catch (e) {
      if (e instanceof OAuthError) {
        router.replace("/welcome");
        return;
      }
      const msg = e instanceof GoogleAPIError ? e.apiMessage : e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-wider text-fg-faint">
          Inspect
        </p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-fg">
          Is a URL indexed?
        </h1>
        <p className="mt-1 text-sm text-fg-muted">
          Ask Google directly. The URL must belong to one of your verified
          Search Console properties.
        </p>
      </div>

      <Card padding="md">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-fg-faint">
              <Search size={14} />
            </span>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void onSubmit()}
              placeholder="https://example.com/page"
              className="w-full rounded-md border border-border bg-surface py-2 pl-9 pr-4 font-mono text-xs transition-colors hover:border-border-strong focus:border-accent focus:outline-none"
            />
          </div>
          <Button
            onClick={() => void onSubmit()}
            loading={loading}
            disabled={!url.trim()}
            iconRight={!loading ? <ArrowRight size={14} /> : undefined}
          >
            {loading ? "Asking…" : "Inspect"}
          </Button>
        </div>

        {error && (
          <div className="mt-3 rounded-md border border-err/40 bg-err/[0.04] px-3 py-2 text-xs text-err">
            {error}
          </div>
        )}
      </Card>

      {result && !loading && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
        >
          <Card padding="md">
            <div className="mb-4 flex items-baseline justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] uppercase tracking-wider text-fg-faint">
                  Result for
                </p>
                <p className="truncate font-mono text-xs text-fg">
                  {result.url}
                </p>
              </div>
              <StatusPill tone={result.indexed ? "ok" : "err"} pulse={false}>
                {result.indexed ? "INDEXED" : "NOT INDEXED"}
              </StatusPill>
            </div>

            <div className="mb-4 space-y-0.5">
              <p className="text-[11px] uppercase tracking-wider text-fg-faint">
                Property
              </p>
              <p className="truncate font-mono text-xs text-fg-muted">
                {result.property_url}
              </p>
            </div>

            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-t border-border pt-4 sm:grid-cols-3">
              <Field label="Verdict" value={result.raw.indexStatusResult?.verdict} />
              <Field label="Coverage" value={result.raw.indexStatusResult?.coverageState} />
              <Field
                label="Indexing"
                value={result.raw.indexStatusResult?.indexingState}
              />
              <Field
                label="Last crawl"
                value={result.raw.indexStatusResult?.lastCrawlTime}
              />
              <Field
                label="Page fetch"
                value={result.raw.indexStatusResult?.pageFetchState}
              />
              <Field
                label="Robots.txt"
                value={result.raw.indexStatusResult?.robotsTxtState}
              />
            </dl>
          </Card>
        </motion.div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-fg-faint">
        {label}
      </dt>
      <dd className="mt-0.5 font-mono text-xs text-fg">
        {value ?? <span className="text-fg-faint">—</span>}
      </dd>
    </div>
  );
}
