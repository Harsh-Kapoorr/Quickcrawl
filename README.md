# Quickcrawl

Bulk-submit URLs to Google's [Indexing API](https://developers.google.com/search/apis/indexing-api/v3/quickstart) through your own verified Search Console properties. **100% client-side static app — every user's credentials and tokens live in their own browser.**

Bring your own Google OAuth client (BYO), paste it in once, and submit URLs. Everything is stored in `localStorage` on the user's own device — there is no server, no database, no admin.

> MIT-licensed. Open source. Read the code, self-host, or use the hosted demo.

---

## How it works

```
Browser (HTTPS)
   │
   ├── localStorage  ← Client ID, Secret, Tokens, Properties, Jobs (yours only)
   │
   └── Direct calls to Google APIs
         ├── accounts.google.com / oauth2.googleapis.com   (OAuth + PKCE)
         ├── indexing.googleapis.com                       (publish URLs)
         └── searchconsole.googleapis.com / webmasters    (list sites + inspect)

Static site hosted on Vercel (or any static host).
No backend. No DB. No cron. No env vars.
```

That's it. Deploy the static `out/` folder to anything that serves files.

---

## What each user does (one time)

### 1. Create a Google Cloud OAuth client

1. Open [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials).
2. Click **Create credentials → OAuth client ID**.
3. Application type: **Web application**. Name it anything (e.g. `Quickcrawl`).
4. Under **Authorized redirect URIs**, click **Add URI** and paste the URL of the app + `/welcome`:
   ```
   https://gsc-indexer.vercel.app/welcome
   ```
   (Use `http://localhost:3000/welcome` for local dev.)
5. Click **Create**, then copy the **Client ID** and **Client secret**.

### 2. Enable the required APIs

[APIs & Services → Library](https://console.cloud.google.com/apis/library) → enable both:
- **Indexing API**
- **Search Console API**

### 3. Set up the OAuth consent screen

[APIs & Services → OAuth consent screen](https://console.cloud.google.com/apis/credentials/consent):
- User type: **External**
- Scopes: `openid`, `email`, `profile`,
  `https://www.googleapis.com/auth/indexing`,
  `https://www.googleapis.com/auth/webmasters.readonly`
- Add your Google account as a **test user**.

### 4. Use the app

1. Open the deployed app URL.
2. Paste your **Client ID** and **Client secret** into the onboarding form. They're saved to your browser's `localStorage` only.
3. Click **Continue with Google** and grant access.
4. Click **Sync from Google** on the dashboard (or Settings) to load your verified Search Console sites.
5. Paste URLs, hit **Submit**.

That's the whole flow. Your Google account must be the **owner** of the Search Console properties you want to submit URLs for.

---

## Deploy your own (one click)

### Vercel

1. Fork or clone this repo.
2. Import into Vercel — it'll detect Next.js automatically.
3. Deploy. That's it — no environment variables to set.

The headers in `vercel.json` set CSP, `X-Frame-Options`, etc. for safety.

### Any other static host

```bash
cd frontend
pnpm install
pnpm build      # outputs to ./out
```

Upload the contents of `out/` to any static host (Netlify, GitHub Pages, Cloudflare Pages, S3+CloudFront, etc.).

### Local development

```bash
cd frontend
pnpm install
pnpm dev        # http://localhost:3000
```

When testing locally, set your OAuth client's redirect URI to `http://localhost:3000/welcome`.

---

## How the data flows

Everything lives in your browser's `localStorage` under these keys:

| Key | Contents |
|---|---|
| `qc.google_credentials` | `{ client_id, client_secret, redirect_uri }` |
| `qc.google_tokens` | `{ access_token, refresh_token, expires_at, email, … }` |
| `qc.properties` | `[{ site_url, permission_level, last_synced }]` |
| `qc.batches` | `[{ id, name, property_url, total, pending, succeeded, failed, … }]` |
| `qc.jobs` | `[{ id, batch_id, url, status, attempts, last_error, … }]` |
| `qc.quota` | `{ date, count }` |
| `qc.oauth_state` | `{ state, code_verifier }` (transient) |

Clearing browser data signs you out and wipes everything. Re-paste credentials and sign in again to start fresh.

### OAuth flow (client-side)

1. Click **Continue with Google**.
2. App generates PKCE pair + random `state`, stashes them in `qc.oauth_state`.
3. Browser navigates to Google's authorize endpoint with PKCE challenge.
4. User grants consent.
5. Google redirects back to `${origin}/welcome?code=…&state=…`.
6. App detects the redirect, exchanges the `code` + verifier for tokens by calling `oauth2.googleapis.com/token` directly, and stashes the tokens in `qc.google_tokens`.
7. App routes to the dashboard.

The `client_secret` is sent to Google over HTTPS during the token exchange. It's never sent to any other origin. **If the user's machine or browser is compromised, the secret is exposed** — same risk as any local app storing credentials.

### URL submission

- One URL at a time, throttled to 1 req/sec on the client.
- The 200/day cap is Google's server-side limit (we also track it client-side for the UI ring).
- Failed requests (5xx, 429) show up as `failed` in the batch detail page; click **Retry** to re-submit.
- 4xx errors are permanent (won't be auto-retried).

---

## Limitations (intentional / scope)

- **No cross-device sync.** If you switch browsers or clear localStorage, you re-enter credentials. This is the trade-off for "no server".
- **No background queue.** If you close the tab mid-submission, the remaining URLs in that batch stay `pending` forever. Re-open the batch and click Retry on each, or submit a fresh batch.
- **Google's 200/day quota is hard.** Server-enforced; we can't help you exceed it.
- **No multi-account.** Each browser is one Google account. Sign out + sign in to switch.

---

## Security

| Concern | Mitigation |
|---|---|
| Stolen session cookie | Not applicable — no session cookies, all state in localStorage |
| CSRF on OAuth callback | Random 256-bit `state`, one-shot |
| Code interception | OAuth 2.0 PKCE S256 |
| Subdomain injection | URL-aware property matching (scheme + host + path-boundary) |
| Clickjacking | `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'` |
| Content sniffing | `X-Content-Type-Options: nosniff` |
| Compromised server | None — there is no server. The static host can't read user data. |
| Quota exhaustion | Tracked client-side, recorded against your Google account |

### Threats we explicitly don't defend against

- A compromised browser or local machine — localStorage is plaintext at the OS level. Use a passphrase-locked OS profile.
- A malicious browser extension with `localStorage` access.
- A user who voluntarily exports their credentials.

---

## Development

```bash
cd frontend
pnpm install
pnpm typecheck    # tsc --noEmit
pnpm build        # static export → ./out
pnpm dev          # http://localhost:3000 (HMR)
```

### Layout

```
frontend/
├── app/
│   ├── layout.tsx                 root layout + fonts + navbar
│   ├── page.tsx                   dashboard (URL submit + recent activity)
│   ├── welcome/page.tsx           onboarding form + OAuth callback handler
│   ├── batches/
│   │   ├── page.tsx               batch history
│   │   └── detail/page.tsx        single batch + per-job retry
│   ├── inspect/page.tsx           Search Console URL inspection
│   ├── settings/page.tsx          credentials, properties, danger zone
│   └── globals.css
├── components/                    React UI
├── lib/
│   ├── store.ts                   localStorage wrapper
│   ├── google-client.ts           PKCE OAuth + Google API calls (all client-side)
│   ├── api.ts                     type definitions only
│   └── utils.ts                   URL parsing + property matching
├── next.config.js                 output: 'export'
└── vercel.json                    headers (CSP, X-Frame-Options, etc.)
```

---

## License

MIT
