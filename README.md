# Quickcrawl

> **Bulk-submit URLs to Google's [Indexing API](https://developers.google.com/search/apis/indexing-api/v3/quickstart) — 100% client-side, your credentials stay in your browser.**

No server. No database. No vendor quota. You bring your own Google OAuth client, paste it in once, and submit URLs straight from the browser to Google's Indexing API.

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-14-black?logo=next.js)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue?logo=typescript)](https://www.typescriptlang.org)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#contributing)

---

## Why

If you publish content, you know the pain: Google discovers new URLs on its own schedule, and a fresh post can sit unindexed for days. The Indexing API lets you ask Google to crawl a URL right now — but Google's web UI only accepts 200/day and the official tooling assumes you have a backend.

Quickcrawl is the missing frontend. Open the page, sign in with Google, paste URLs, hit submit. The calls go from your browser directly to Google's API. Nothing is stored anywhere except your own browser.

## Features

- **Direct browser → Google.** OAuth 2.0 + PKCE S256. No proxy.
- **Bulk submit.** Paste a list, drop a `.txt`, or load URLs from a spreadsheet.
- **Batch tracking.** Every submission is recorded with status (pending / submitted / failed), attempts, last error, and Google's `notifyTime`.
- **Throttled to Google's limits.** 1 req/sec, 200/day. UI ring + soft dedup warnings when you try to re-submit.
- **Search Console URL inspection.** Ask Google directly whether a URL is indexed.
- **Multi-property support.** Sync all verified Search Console properties and submit to any of them.
- **No server.** Static export. Host on Vercel, Netlify, Cloudflare Pages, GitHub Pages, S3 — anywhere that serves files.

## Quick start

```bash
git clone https://github.com/Harsh-Kapoorr/Quickcrawl.git
cd Quickcrawl/frontend
pnpm install
pnpm dev          # http://localhost:3000
```

Then open the app and follow the inline tutorial — it walks you through creating an OAuth client in Google Cloud Console and pasting the credentials in.

> You need **one** Google account that is the **owner** of the Search Console properties you want to submit to.

## Architecture

```
┌──────────────────────── Browser ────────────────────────┐
│                                                          │
│  localStorage (yours only, never transmitted)            │
│  ├── qc.google_credentials   Client ID + Secret          │
│  ├── qc.google_tokens        Access + Refresh tokens      │
│  ├── qc.properties           Search Console sites         │
│  ├── qc.batches / qc.jobs    Submission history           │
│  └── qc.quota               Daily submit count            │
│                                                          │
│  Direct calls → Google APIs                              │
│  ├── accounts.google.com        OAuth consent             │
│  ├── oauth2.googleapis.com      Token exchange (PKCE)     │
│  ├── indexing.googleapis.com    URL publish               │
│  └── searchconsole.googleapis.com  Site list + inspect   │
│                                                          │
└──────────────────────────────────────────────────────────┘
        ▲                                                  ▲
        │  static HTML / JS                                 │
        │                                                  │
  ┌─────┴──────┐                                  ┌────────┴────────┐
  │  Your CDN  │   ←——— no backend —————          │  Google APIs   │
  │  (Vercel,  │                                  │  (no Quickcrawl │
  │   Netlify) │                                  │   server in the │
  └────────────┘                                  │   middle)       │
                                                   └─────────────────┘
```

## Deploy

### Vercel (one click)

1. Fork this repo.
2. Import into Vercel — it detects Next.js automatically.
3. Deploy. **No environment variables to set.**

`vercel.json` ships with CSP, `X-Frame-Options`, `Referrer-Policy`, and `Permissions-Policy` headers already configured.

### Any static host

```bash
cd frontend
pnpm install
pnpm build      # static export → ./out
```

Upload `out/` to Netlify, Cloudflare Pages, GitHub Pages, S3 + CloudFront, or any host that serves files.

## Development

```bash
cd frontend

pnpm dev          # http://localhost:3000  (HMR)
pnpm typecheck    # tsc --noEmit
pnpm build        # static export → ./out
```

### Project layout

```
frontend/
├── app/
│   ├── layout.tsx                 root layout + fonts + navbar
│   ├── page.tsx                   dashboard (URL submit + recent activity)
│   ├── welcome/                   onboarding + OAuth callback
│   ├── batches/                   batch history + per-job retry
│   ├── inspect/                   Search Console URL inspection
│   ├── settings/                  credentials, properties, danger zone
│   └── globals.css
├── components/                    React UI (Card, Button, DropZone, …)
├── lib/
│   ├── store.ts                   localStorage wrapper
│   ├── google-client.ts           PKCE OAuth + Google API calls
│   ├── api.ts                     type definitions
│   └── utils.ts                   URL parsing + property matching
├── public/                        static assets (logo, hero image)
└── vercel.json                    security headers
```

## Security

| Concern | Mitigation |
|---|---|
| CSRF on OAuth callback | 256-bit random `state`, one-shot |
| Authorization code interception | OAuth 2.0 PKCE S256 |
| Subdomain-injection in URLs | URL-aware property matching (scheme + host + path-boundary) |
| Clickjacking | `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'` |
| Content sniffing | `X-Content-Type-Options: nosniff` |
| Compromised server | N/A — there is no server. The static host can't read user data. |

### Threats we don't defend against

These are inherent to a client-side credential model and require user action to mitigate:

- A compromised browser or local machine (localStorage is plaintext at the OS level). Use a passphrase-locked OS profile.
- A malicious browser extension with `localStorage` access.
- A user who voluntarily exports their credentials.

> **Heads up:** your `client_secret` lives in your browser's `localStorage`. Same risk profile as any local app storing credentials — the trade-off for "no server, no vendor". If this is unacceptable for your threat model, don't use Quickcrawl.

## Limitations (intentional)

- **No cross-device sync.** Switching browsers or clearing `localStorage` means re-entering credentials. This is the price of "no server".
- **No background queue.** Closing the tab mid-submission leaves remaining URLs `pending`. Re-open the batch and click Retry, or submit a fresh batch.
- **Google's 200/day quota is hard.** Server-enforced; we can't help you exceed it.
- **No multi-account.** Each browser is one Google account. Sign out + sign in to switch.

## Contributing

Issues and PRs welcome. The whole codebase is ~2k lines of TypeScript — read [`frontend/lib/google-client.ts`](frontend/lib/google-client.ts) for the OAuth + API layer and [`frontend/app/page.tsx`](frontend/app/page.tsx) for the submit flow.

Please don't commit real OAuth credentials. The repo ships an `.env.example` template only.

## License

MIT © Quickcrawl contributors
