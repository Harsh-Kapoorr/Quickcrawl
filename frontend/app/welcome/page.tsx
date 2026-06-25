"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";

import { Button } from "@/components/Button";
import { getCredentials, getTokens, setCredentials } from "@/lib/store";
import { completeOAuth, startOAuth } from "@/lib/google-client";

function isValidClientId(s: string): boolean {
  return /^[a-zA-Z0-9-]+\.apps\.googleusercontent\.com$/.test(s.trim());
}

function isValidClientSecret(s: string): boolean {
  return /^GOCSPX-[a-zA-Z0-9-_]+$/.test(s.trim());
}

type Stage = "hero" | "creds" | "google" | "how" | "help";

const HOW_STEPS: Array<{ n: number; title: string; body: string }> = [
  {
    n: 1,
    title: "Bring your own OAuth client",
    body:
      "Create a Web OAuth client in Google Cloud Console (one-time, ~2 minutes). Your Client ID + Secret are saved only in your browser.",
  },
  {
    n: 2,
    title: "Sign in with Google",
    body:
      "We use PKCE + a 256-bit CSRF state — no password ever leaves your machine. Direct browser → Google, no proxy server.",
  },
  {
    n: 3,
    title: "Sync your Search Console sites",
    body:
      "Click Sync — Quickcrawl calls the Webmasters API and lists every property your account owns. Pick the one(s) you want to submit to.",
  },
  {
    n: 4,
    title: "Paste URLs, hit submit",
    body:
      "Drop a list (or a .txt file). We validate each URL against your verified properties, throttle to 1 req/sec, then call the Indexing API directly from your browser.",
  },
  {
    n: 5,
    title: "Watch Google crawl",
    body:
      "Google's 200/day quota is enforced server-side; we track it client-side too. Every job's status — pending, submitted, failed — is recorded in your batch history.",
  },
];

const HELP_STEPS: Array<{ n: number; title: string; body: string }> = [
  {
    n: 1,
    title: "Open Google Cloud Console → Credentials",
    body:
      "Go to console.cloud.google.com → APIs & Services → Credentials. Sign in with the Google account that owns your Search Console properties.",
  },
  {
    n: 2,
    title: "Create an OAuth client (Web application)",
    body:
      "Click + Create credentials → OAuth client ID. Choose Application type: Web application. Name it anything (e.g. Quickcrawl).",
  },
  {
    n: 3,
    title: "Add this redirect URI",
    body:
      "Under Authorized redirect URIs, click + Add URI and paste the URL below exactly. Then click Create.",
  },
  {
    n: 4,
    title: "Enable Indexing API + Search Console API",
    body:
      "Open APIs & Services → Library. Search and enable both: Indexing API and Search Console API. These scopes are required to submit URLs and list properties.",
  },
  {
    n: 5,
    title: "Copy Client ID + Secret back here",
    body:
      "Back on the Credentials page, click your new OAuth client. Copy the Client ID (ends in .apps.googleusercontent.com) and the Client Secret (starts with GOCSPX-) into the form on this page.",
  },
];

export default function WelcomePage() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("hero");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const redirectUri =
    typeof window !== "undefined" ? `${window.location.origin}/welcome` : "/welcome";

  useEffect(() => {
    // OAuth callback handler — runs when Google redirects back with ?code=...
    const params = new URLSearchParams(window.location.search);
    if (params.has("code") || params.has("error")) {
      completeOAuth(window.location.search)
        .then(() => router.replace("/"))
        .catch((e) => {
          setError(e instanceof Error ? e.message : String(e));
          setStage("google");
        });
      return;
    }

    const tokens = getTokens();
    if (tokens) {
      router.replace("/");
      return;
    }
    const creds = getCredentials();
    if (creds) {
      setClientId(creds.client_id);
      setStage("google");
    }
  }, [router]);

  const saveCreds = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!isValidClientId(clientId)) {
      setError("Client ID must look like xxx.apps.googleusercontent.com");
      return;
    }
    if (!isValidClientSecret(clientSecret)) {
      setError("Client secret must start with GOCSPX-");
      return;
    }
    setSaving(true);
    setCredentials({
      client_id: clientId.trim(),
      client_secret: clientSecret.trim(),
      redirect_uri: redirectUri,
    });
    setStage("google");
    setSaving(false);
  };

  const startGoogleSignIn = async () => {
    setError(null);
    try {
      const url = await startOAuth(redirectUri);
      window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <main className="h-[calc(100vh-160px)] overflow-hidden bg-bg">
      <div className="mx-auto flex h-full max-w-6xl flex-col px-6">
        <div id="get-started" className="flex flex-1 items-center pt-4">
          <AnimatePresence mode="wait">
            {stage === "hero" ? (
              <motion.section
                key="hero"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.35 }}
                className="flex w-full flex-col"
              >
                <div className="relative w-full overflow-hidden rounded-2xl border border-border/60 bg-surface shadow-[0_8px_40px_-12px_rgba(0,0,0,0.25)]">
                  <img
                    src="/hero-mosaic.jpg"
                    alt="Mosaic-style illustration of the Colosseum"
                    className="block h-auto w-full"
                    style={{ aspectRatio: "16 / 7.2", objectFit: "cover" }}
                  />
                </div>

                <div className="mx-auto mt-6 max-w-3xl text-center">
                  <h1 className="font-display text-4xl font-medium leading-[1.1] tracking-tight text-fg sm:text-5xl">
                    See Further. Index Faster.
                  </h1>
                  <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-fg-muted sm:text-base">
                    Quickcrawl hands you direct access to Google&apos;s Indexing API.
                    Paste URLs, hit submit, watch Google crawl them — no middleman,
                    no quota vendor, 100% client-side.
                  </p>

                  <div className="mt-5 flex items-center justify-center gap-3">
                    <Button
                      size="lg"
                      variant="primary"
                      onClick={() => setStage("creds")}
                    >
                      Get Started
                    </Button>
                    <button
                      type="button"
                      onClick={() => setStage("how")}
                      className="text-sm text-fg-muted underline-offset-4 hover:text-fg hover:underline"
                    >
                      How it works
                    </button>
                  </div>
                </div>
              </motion.section>
            ) : stage === "creds" ? (
              <CredsStage
                key="creds"
                clientId={clientId}
                clientSecret={clientSecret}
                setClientId={setClientId}
                setClientSecret={setClientSecret}
                error={error}
                saving={saving}
                redirectUri={redirectUri}
                onSubmit={saveCreds}
                onBack={() => setStage("hero")}
              />
            ) : stage === "google" ? (
              <GoogleStage
                key="google"
                redirectUri={redirectUri}
                error={error}
                onStart={startGoogleSignIn}
                onReplaceCredentials={() => {
                  if (confirm("Clear saved credentials? You'll need to re-enter them.")) {
                    localStorage.removeItem("qc.google_credentials");
                    setClientSecret("");
                    setStage("creds");
                  }
                }}
                onBack={() => setStage("hero")}
              />
            ) : stage === "how" ? (
              <ProcessStage
                key="how"
                eyebrow="How it works"
                title="From URL to indexed, in five steps."
                subtitle="Everything runs in your browser. Your tokens, your credentials, your data."
                steps={HOW_STEPS}
                onBack={() => setStage("hero")}
                footer={
                  <Button onClick={() => setStage("creds")}>
                    Get Started →
                  </Button>
                }
              />
            ) : (
              <ProcessStage
                key="help"
                eyebrow="Get your Google credentials"
                title="Create an OAuth client in five steps."
                subtitle="One-time setup. Takes about two minutes."
                steps={HELP_STEPS}
                redirectUri={redirectUri}
                onBack={() => setStage("hero")}
                footer={
                  <Button onClick={() => setStage("creds")}>
                    I have my credentials →
                  </Button>
                }
              />
            )}
          </AnimatePresence>
        </div>
      </div>
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* Stages                                                              */
/* ------------------------------------------------------------------ */

function CredsStage({
  clientId,
  clientSecret,
  setClientId,
  setClientSecret,
  error,
  saving,
  redirectUri,
  onSubmit,
  onBack,
}: {
  clientId: string;
  clientSecret: string;
  setClientId: (v: string) => void;
  setClientSecret: (v: string) => void;
  error: string | null;
  saving: boolean;
  redirectUri: string;
  onSubmit: (e: React.FormEvent) => void;
  onBack: () => void;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.3 }}
      className="mx-auto flex w-full max-w-xl flex-col"
    >
      <div className="mb-3 text-center">
        <p className="text-[11px] font-medium uppercase tracking-wider text-fg-muted">
          Step 1 of 2
        </p>
        <h2 className="mt-1 font-display text-2xl font-medium tracking-tight text-fg">
          Add your Google credentials
        </h2>
        <p className="mx-auto mt-1 max-w-md text-xs text-fg-muted">
          Create a Web OAuth client in Google Cloud Console, then paste the
          Client ID and Secret below. They&apos;re saved in this browser only —
          never sent to a server.
        </p>
      </div>

      {error && (
        <div className="mb-3 rounded-md border border-err/40 bg-err/5 px-3 py-2 text-xs text-err">
          {error}
        </div>
      )}

      <form
        onSubmit={onSubmit}
        className="rounded-2xl border border-border bg-surface p-5 shadow-[0_8px_40px_-12px_rgba(0,0,0,0.25)]"
      >
        <div className="space-y-3">
          <div className="space-y-1">
            <label
              htmlFor="cid"
              className="block text-[11px] font-medium uppercase tracking-wider text-fg-muted"
            >
              Client ID
            </label>
            <input
              id="cid"
              type="text"
              required
              autoComplete="off"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="123456789-xxx.apps.googleusercontent.com"
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 font-mono text-xs transition-all hover:border-border-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
            <p className="text-[10px] text-fg-faint">
              Looks like{" "}
              <code className="font-mono text-fg-muted">
                123456789-xxx.apps.googleusercontent.com
              </code>
            </p>
          </div>

          <div className="space-y-1">
            <label
              htmlFor="csec"
              className="block text-[11px] font-medium uppercase tracking-wider text-fg-muted"
            >
              Client secret
            </label>
            <input
              id="csec"
              type="password"
              required
              autoComplete="off"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder="GOCSPX-xxxxxxxxxxxx"
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 font-mono text-xs transition-all hover:border-border-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
            <p className="text-[10px] text-fg-faint">
              Starts with{" "}
              <code className="font-mono text-fg-muted">GOCSPX-</code>. Click
              the eye icon next to the secret in Cloud Console to reveal it.
            </p>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Button type="submit" variant="primary" size="md" loading={saving}>
              {saving ? "Saving…" : "Continue"}
            </Button>
            <button
              type="button"
              onClick={onBack}
              className="text-xs text-fg-muted underline-offset-4 hover:text-fg hover:underline"
            >
              ← Back
            </button>
          </div>
        </div>
      </form>

      {/* Dropdown tutorial — same expandable style as the original welcome page. */}
      <details className="group mt-4 rounded-xl border border-border/60 bg-surface/70 px-4 py-2.5 text-left text-xs text-fg-muted shadow-sm backdrop-blur-sm open:bg-surface">
        <summary className="cursor-pointer text-[11px] font-medium uppercase tracking-wider text-fg-muted hover:text-fg">
          How to create the OAuth client
        </summary>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-xs leading-relaxed">
          <li>
            Open{" "}
            <a
              href="https://console.cloud.google.com/apis/credentials"
              target="_blank"
              rel="noreferrer noopener"
              className="text-fg underline-offset-4 hover:opacity-80"
            >
              Google Cloud Console → APIs & Services → Credentials
            </a>
            .
          </li>
          <li>
            Click{" "}
            <span className="font-medium text-fg">Create credentials → OAuth client ID</span>.
          </li>
          <li>
            Application type:{" "}
            <span className="font-medium text-fg">Web application</span>. Name it anything
            (e.g. <code className="rounded bg-bg-subtle px-1 font-mono">Quickcrawl</code>).
          </li>
          <li>
            Under{" "}
            <span className="font-medium text-fg">Authorized redirect URIs</span>, click{" "}
            <span className="font-medium text-fg">Add URI</span> and paste this exact value:
            <div className="mt-1 flex items-center gap-2">
              <code className="flex-1 break-all rounded bg-bg-subtle px-2 py-1 font-mono text-[11px] text-fg">
                {redirectUri}
              </code>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(redirectUri)}
                className="shrink-0 rounded-md border border-border px-2 py-1 text-[11px] text-fg-muted hover:border-border-strong hover:text-fg"
              >
                Copy
              </button>
            </div>
          </li>
          <li>
            Click <span className="font-medium text-fg">Create</span>, then copy the{" "}
            <span className="font-medium text-fg">Client ID</span> and{" "}
            <span className="font-medium text-fg">Client secret</span> into the form above.
          </li>
          <li>
            Enable both{" "}
            <span className="font-medium text-fg">Indexing API</span> and{" "}
            <span className="font-medium text-fg">Search Console API</span> under{" "}
            <a
              href="https://console.cloud.google.com/apis/library"
              target="_blank"
              rel="noreferrer noopener"
              className="text-fg underline-offset-4 hover:opacity-80"
            >
              APIs & Services → Library
            </a>
            .
          </li>
          <li>
            Under{" "}
            <a
              href="https://console.cloud.google.com/apis/credentials/consent"
              target="_blank"
              rel="noreferrer noopener"
              className="text-fg underline-offset-4 hover:opacity-80"
            >
              OAuth consent screen
            </a>
            , set User type to <span className="font-medium text-fg">External</span>, add the
            scopes listed in the README, and add yourself as a{" "}
            <span className="font-medium text-fg">test user</span>.
          </li>
        </ol>
      </details>
    </motion.section>
  );
}

function GoogleStage({
  redirectUri,
  error,
  onStart,
  onReplaceCredentials,
  onBack,
}: {
  redirectUri: string;
  error: string | null;
  onStart: () => void;
  onReplaceCredentials: () => void;
  onBack: () => void;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.3 }}
      className="mx-auto flex w-full max-w-md flex-col items-center"
    >
      <div className="mb-3 text-center">
        <p className="text-[11px] font-medium uppercase tracking-wider text-fg-muted">
          Step 2 of 2
        </p>
        <h2 className="mt-1 font-display text-2xl font-medium tracking-tight text-fg">
          Sign in with Google
        </h2>
        <p className="mx-auto mt-1 max-w-sm text-xs text-fg-muted">
          Grant access so Quickcrawl can list your Search Console properties
          and submit URLs on your behalf.
        </p>
      </div>

      {error && (
        <div className="mb-3 w-full rounded-md border border-err/40 bg-err/5 px-3 py-2 text-xs text-err">
          {error}
        </div>
      )}

      <div className="w-full rounded-2xl border border-border bg-surface p-5 shadow-[0_8px_40px_-12px_rgba(0,0,0,0.25)]">
        <Button onClick={onStart} variant="primary" size="lg" className="w-full">
          Continue with Google →
        </Button>
        <p className="mt-2 text-center text-[11px] text-fg-faint">
          You&apos;ll be redirected to{" "}
          <code className="font-mono text-fg-muted">{redirectUri}</code>
        </p>
      </div>

      <div className="mt-3 flex items-center gap-3 text-xs">
        <button
          type="button"
          onClick={onBack}
          className="text-fg-muted underline-offset-4 hover:text-fg hover:underline"
        >
          ← Back
        </button>
        <span className="text-fg-faint">·</span>
        <button
          type="button"
          className="text-fg-muted underline-offset-4 hover:text-fg hover:underline"
          onClick={onReplaceCredentials}
        >
          Replace credentials
        </button>
      </div>
    </motion.section>
  );
}

function ProcessStage({
  eyebrow,
  title,
  subtitle,
  steps,
  redirectUri,
  onBack,
  footer,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  steps: Array<{ n: number; title: string; body: string }>;
  redirectUri?: string;
  onBack: () => void;
  footer: React.ReactNode;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.3 }}
      className="mx-auto flex w-full max-w-4xl flex-col"
    >
      <div className="mb-4 text-center">
        <p className="text-[11px] font-medium uppercase tracking-wider text-fg-muted">
          {eyebrow}
        </p>
        <h2 className="mt-1 font-display text-2xl font-medium tracking-tight text-fg sm:text-3xl">
          {title}
        </h2>
        <p className="mx-auto mt-1 max-w-xl text-xs text-fg-muted sm:text-sm">
          {subtitle}
        </p>
        {redirectUri && (
          <div className="mx-auto mt-3 inline-flex items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5">
            <code className="font-mono text-[11px] text-fg">{redirectUri}</code>
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(redirectUri)}
              className="text-[11px] text-fg-muted underline-offset-4 hover:text-fg hover:underline"
            >
              Copy
            </button>
          </div>
        )}
      </div>

      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {steps.map((s) => (
          <li
            key={s.n}
            className="rounded-xl border border-border bg-surface p-4"
          >
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-[11px] font-medium text-fg-muted">
                {String(s.n).padStart(2, "0")}
              </span>
              <h3 className="text-sm font-semibold tracking-tight text-fg">
                {s.title}
              </h3>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-fg-muted">{s.body}</p>
          </li>
        ))}
      </ol>

      <div className="mt-4 flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="text-xs text-fg-muted underline-offset-4 hover:text-fg hover:underline"
        >
          ← Back
        </button>
        {footer}
      </div>
    </motion.section>
  );
}