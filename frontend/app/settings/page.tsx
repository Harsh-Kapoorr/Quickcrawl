"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";

import { Card, CardHeader, CardTitle } from "@/components/Card";
import { Button } from "@/components/Button";
import { StatusPill } from "@/components/StatusPill";
import { Refresh, Logout, Check, Trash } from "@/components/Icon";
import { fmtRelative, truncateMiddle } from "@/lib/utils";
import {
  clearCredentials,
  clearTokens,
  getBatches,
  getCredentials,
  getProperties,
  getTokens,
  setCredentials,
  setProperties,
  wipeAll,
  type StoredCredentials,
} from "@/lib/store";
import { GoogleAPIError, OAuthError, listSites } from "@/lib/google-client";

export default function SettingsPage() {
  const router = useRouter();
  const [creds, setCreds] = useState<StoredCredentials | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [properties, setProps] = useState(getProperties());
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!getTokens()) {
      router.replace("/welcome");
      return;
    }
    setCreds(getCredentials());
    setEmail(getTokens()?.email ?? null);
    setProps(getProperties());
  }, [router]);

  const onSync = async () => {
    setSyncing(true);
    setMsg(null);
    try {
      const sites = await listSites();
      const now = new Date().toISOString();
      const mapped = sites.map((s) => ({
        site_url: s.siteUrl,
        permission_level: s.permissionLevel ?? "siteOwner",
        last_synced: now,
      }));
      setProperties(mapped);
      setProps(mapped);
      setMsg(`Synced ${mapped.length} site${mapped.length === 1 ? "" : "s"} from Google.`);
    } catch (e) {
      if (e instanceof OAuthError) {
        router.replace("/welcome");
        return;
      }
      const text = e instanceof GoogleAPIError ? e.apiMessage : e instanceof Error ? e.message : String(e);
      setMsg(`Sync failed: ${text}`);
    } finally {
      setSyncing(false);
    }
  };

  const onLogout = () => {
    clearTokens();
    router.replace("/welcome");
  };

  const onClearAll = () => {
    if (
      confirm(
        "Clear ALL local data (credentials, tokens, properties, batches, jobs)?\n\nThis cannot be undone.",
      )
    ) {
      wipeAll();
      router.replace("/welcome");
    }
  };

  const onReplaceCreds = () => {
    if (confirm("Replace stored credentials? You'll need to sign in with Google again.")) {
      clearCredentials();
      clearTokens();
      router.replace("/welcome");
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="mx-auto max-w-3xl space-y-8"
    >
      <div>
        <p className="text-[11px] font-medium uppercase tracking-wider text-fg-faint">
          Settings
        </p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-fg">
          Your account
        </h1>
      </div>

      {/* Google account */}
      <section>
        <CardHeader>
          <CardTitle>Google account</CardTitle>
          {email && <StatusPill tone="ok">{email}</StatusPill>}
        </CardHeader>
        <Card padding="md">
          <dl className="grid gap-3 text-xs sm:grid-cols-2">
            <Field label="Email" value={email ?? "—"} />
            <Field label="Storage" value="Browser localStorage only" />
            <Field
              label="Client ID"
              value={creds?.client_id ?? "—"}
              mono
            />
          </dl>
        </Card>
      </section>

      {/* OAuth client */}
      <section>
        <CardHeader>
          <CardTitle>OAuth client</CardTitle>
          <Button variant="secondary" size="sm" onClick={onReplaceCreds}>
            Replace credentials
          </Button>
        </CardHeader>
        <Card padding="md">
          <p className="text-xs text-fg-muted">
            Your credentials are stored in this browser&apos;s localStorage only.
            Clearing browser data will sign you out.
          </p>
          <p className="mt-3 text-[11px] text-fg-faint">
            Redirect URI registered in Google Cloud Console:{" "}
            <code className="rounded bg-bg-subtle px-1.5 py-0.5 font-mono text-[11px] text-fg">
              {creds?.redirect_uri ?? "—"}
            </code>
          </p>
        </Card>
      </section>

      {/* Properties */}
      <section>
        <CardHeader>
          <CardTitle>Verified properties</CardTitle>
          <Button
            variant="secondary"
            size="sm"
            loading={syncing}
            onClick={onSync}
            icon={<Refresh size={12} />}
          >
            {syncing ? "Syncing…" : "Sync from Google"}
          </Button>
        </CardHeader>

        {msg && (
          <div className="mb-3 rounded-md border border-border bg-surface px-3 py-2 text-xs text-fg-muted">
            {msg}
          </div>
        )}

        {properties.length === 0 ? (
          <Card padding="md">
            <p className="text-sm text-fg-muted">
              No properties yet. Click{" "}
              <span className="font-medium text-fg">Sync from Google</span> to
              fetch the sites your account owns in Search Console.
            </p>
          </Card>
        ) : (
          <Card padding="none">
            <ul className="divide-y divide-border">
              {properties.map((p) => (
                <li
                  key={p.site_url}
                  className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-bg-subtle/40"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-bg-subtle font-mono text-xs text-fg-muted">
                      {p.site_url.replace(/^https?:\/\//, "").charAt(0).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate font-mono text-xs text-fg">
                        {p.site_url}
                      </div>
                      <div className="text-[11px] text-fg-faint">
                        Synced {fmtRelative(p.last_synced)}
                      </div>
                    </div>
                  </div>
                  <StatusPill tone={p.permission_level === "siteOwner" ? "ok" : "info"}>
                    {p.permission_level}
                  </StatusPill>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      {/* Security */}
      <section>
        <CardHeader>
          <CardTitle>How your data is handled</CardTitle>
        </CardHeader>
        <Card padding="md">
          <ul className="space-y-2 text-xs text-fg-muted">
            <li className="flex items-start gap-2">
              <Check size={12} className="mt-0.5 shrink-0 text-ok" />
              All credentials and tokens live in your browser&apos;s localStorage — never on a server.
            </li>
            <li className="flex items-start gap-2">
              <Check size={12} className="mt-0.5 shrink-0 text-ok" />
              OAuth flow uses PKCE + state CSRF.
            </li>
            <li className="flex items-start gap-2">
              <Check size={12} className="mt-0.5 shrink-0 text-ok" />
              Refresh token rotates on each refresh.
            </li>
            <li className="flex items-start gap-2">
              <Check size={12} className="mt-0.5 shrink-0 text-ok" />
              Hosted as a static site on Vercel — no backend to attack.
            </li>
            <li className="flex items-start gap-2">
              <Check size={12} className="mt-0.5 shrink-0 text-ok" />
              Quota enforced locally (200/day, 1 req/sec) — Google enforces it too.
            </li>
          </ul>
        </Card>
      </section>

      {/* Danger zone */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-4 rounded-lg border border-err/40 p-5">
          <div>
            <h3 className="text-sm font-semibold text-err">Sign out</h3>
            <p className="mt-1 text-xs text-fg-muted">
              Removes access + refresh tokens from this browser. You&apos;ll need
              to sign in with Google again to submit URLs.
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={onLogout} icon={<Logout size={12} />}>
            Sign out
          </Button>
        </div>
        <div className="flex items-baseline justify-between gap-4 rounded-lg border border-err/40 p-5">
          <div>
            <h3 className="text-sm font-semibold text-err">Clear all local data</h3>
            <p className="mt-1 text-xs text-fg-muted">
              Wipes credentials, tokens, properties, batches, and jobs from this
              browser. Cannot be undone.
            </p>
          </div>
          <Button variant="danger" size="sm" onClick={onClearAll} icon={<Trash size={12} />}>
            Wipe
          </Button>
        </div>
      </section>

      <p className="text-center text-[11px] text-fg-faint">
        Open source · <Link href="https://github.com/" className="hover:text-fg-muted">view source</Link>
      </p>
    </motion.div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wider text-fg-faint">
        {label}
      </dt>
      <dd className={`mt-0.5 text-fg ${mono ? "font-mono text-[11px] break-all" : ""}`}>
        {value}
      </dd>
    </div>
  );
}
