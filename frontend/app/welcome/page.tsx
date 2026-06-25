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

type Stage = "hero" | "creds" | "google";

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
        {/* HERO IMAGE — fixed aspect, rounded corners, sits in upper portion */}
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
                {/* Hero image with rounded corners */}
                <div className="relative w-full overflow-hidden rounded-2xl border border-border/60 bg-surface shadow-[0_8px_40px_-12px_rgba(0,0,0,0.25)]">
                  <img
                    src="/hero-mosaic.jpg"
                    alt="Mosaic-style illustration of the Colosseum"
                    className="block h-auto w-full"
                    style={{ aspectRatio: "16 / 7.2", objectFit: "cover" }}
                  />
                </div>

                {/* Headline + subtitle + CTA below image */}
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
                    <a
                      href="#how"
                      className="text-sm text-fg-muted underline-offset-4 hover:text-fg hover:underline"
                    >
                      How it works
                    </a>
                  </div>
                </div>
              </motion.section>
            ) : stage === "creds" ? (
              <motion.section
                key="creds"
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
                    Create a Web OAuth client in Google Cloud Console, then paste
                    the Client ID and Secret below. They&apos;re saved in this browser
                    only — never sent to a server.
                  </p>
                </div>

                {error && (
                  <div className="mb-3 rounded-md border border-err/40 bg-err/5 px-3 py-2 text-xs text-err">
                    {error}
                  </div>
                )}

                <form
                  onSubmit={saveCreds}
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
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      <Button
                        type="submit"
                        variant="primary"
                        size="md"
                        loading={saving}
                      >
                        {saving ? "Saving…" : "Continue"}
                      </Button>
                      <button
                        type="button"
                        onClick={() => setStage("hero")}
                        className="text-xs text-fg-muted underline-offset-4 hover:text-fg hover:underline"
                      >
                        ← Back
                      </button>
                    </div>
                  </div>
                </form>

                <p className="mt-3 text-center text-[11px] text-fg-faint">
                  Need help?{" "}
                  <a
                    href="https://console.cloud.google.com/apis/credentials"
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-fg-muted hover:text-fg"
                  >
                    Create an OAuth client ↗
                  </a>
                </p>
              </motion.section>
            ) : (
              <motion.section
                key="google"
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
                    Grant access so Quickcrawl can list your Search Console
                    properties and submit URLs on your behalf.
                  </p>
                </div>

                {error && (
                  <div className="mb-3 w-full rounded-md border border-err/40 bg-err/5 px-3 py-2 text-xs text-err">
                    {error}
                  </div>
                )}

                <div className="w-full rounded-2xl border border-border bg-surface p-5 shadow-[0_8px_40px_-12px_rgba(0,0,0,0.25)]">
                  <Button
                    onClick={startGoogleSignIn}
                    variant="primary"
                    size="lg"
                    className="w-full"
                  >
                    Continue with Google →
                  </Button>
                  <p className="mt-2 text-center text-[11px] text-fg-faint">
                    You&apos;ll be redirected to{" "}
                    <code className="font-mono text-fg-muted">{redirectUri}</code>
                  </p>
                </div>

                <button
                  type="button"
                  className="mt-3 text-xs text-fg-muted underline-offset-4 hover:text-fg hover:underline"
                  onClick={() => {
                    if (confirm("Clear saved credentials? You'll need to re-enter them.")) {
                      localStorage.removeItem("qc.google_credentials");
                      setClientSecret("");
                      setStage("creds");
                    }
                  }}
                >
                  Wrong client? Replace credentials
                </button>
              </motion.section>
            )}
          </AnimatePresence>
        </div>
      </div>
    </main>
  );
}