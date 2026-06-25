/** Browser-only persistent store. All data lives in localStorage.

Shape:
  google_credentials: { client_id, client_secret, redirect_uri, saved_at }
  google_tokens:      { access_token, refresh_token, expires_at, scope,
                        token_type, email, name, picture, sub, saved_at }
  properties:         Array<{ site_url, permission_level, last_synced }>
  jobs:               Array<Job>     (history of all submissions)
  batches:            Array<Batch>   (one per submission batch)
  quota:              { date: "YYYY-MM-DD", count }
  oauth_state:        { state, code_verifier, redirect_uri }   (transient)

We only run in the browser; every accessor guards for SSR via `typeof window`.
 */

const K = {
  credentials: "qc.google_credentials",
  tokens: "qc.google_tokens",
  properties: "qc.properties",
  jobs: "qc.jobs",
  batches: "qc.batches",
  quota: "qc.quota",
  oauthState: "qc.oauth_state",
} as const;

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota exceeded or storage disabled — best-effort */
  }
}

function remove(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

// ---- credentials ----

export interface StoredCredentials {
  client_id: string;
  client_secret: string;
  redirect_uri: string;
  saved_at: string;
}

export function getCredentials(): StoredCredentials | null {
  return read<StoredCredentials | null>(K.credentials, null);
}

export function setCredentials(c: Omit<StoredCredentials, "saved_at">): void {
  write(K.credentials, { ...c, saved_at: new Date().toISOString() });
}

export function clearCredentials(): void {
  remove(K.credentials);
}

// ---- tokens ----

export interface StoredTokens {
  access_token: string;
  refresh_token?: string;
  expires_at: string; // ISO
  scope?: string;
  token_type?: string;
  email?: string;
  name?: string;
  picture?: string;
  sub?: string;
  saved_at: string;
}

export function getTokens(): StoredTokens | null {
  return read<StoredTokens | null>(K.tokens, null);
}

export function setTokens(t: Omit<StoredTokens, "saved_at">): void {
  write(K.tokens, { ...t, saved_at: new Date().toISOString() });
}

export function clearTokens(): void {
  remove(K.tokens);
}

// ---- properties (Search Console sites) ----

export interface StoredProperty {
  site_url: string;
  permission_level: string;
  last_synced: string;
}

export function getProperties(): StoredProperty[] {
  return read<StoredProperty[]>(K.properties, []);
}

export function setProperties(p: StoredProperty[]): void {
  write(K.properties, p);
}

// ---- batches & jobs ----

export interface StoredBatch {
  id: number;
  name: string | null;
  property_url: string;
  publish_type: "URL_UPDATED" | "URL_DELETED";
  total: number;
  pending: number;
  processing: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  created_at: string;
}

export interface StoredJob {
  id: number;
  batch_id: number;
  url: string;
  property_url: string;
  publish_type: "URL_UPDATED" | "URL_DELETED";
  status: "pending" | "processing" | "submitted" | "failed" | "cancelled";
  attempts: number;
  last_error: string | null;
  http_status: number | null;
  google_notify_time: string | null;
  created_at: string;
  submitted_at: string | null;
  completed_at: string | null;
}

export function getBatches(): StoredBatch[] {
  return read<StoredBatch[]>(K.batches, []);
}

export function setBatches(b: StoredBatch[]): void {
  write(K.batches, b);
}

export function getJobs(): StoredJob[] {
  return read<StoredJob[]>(K.jobs, []);
}

export function setJobs(j: StoredJob[]): void {
  write(K.jobs, j);
}

// ---- quota ----

export interface StoredQuota {
  date: string;
  count: number;
}

export function getQuota(): StoredQuota {
  const today = todayUtc();
  const raw = read<StoredQuota | null>(K.quota, null);
  if (!raw || raw.date !== today) return { date: today, count: 0 };
  return raw;
}

export function setQuota(q: StoredQuota): void {
  write(K.quota, q);
}

export function bumpQuota(): StoredQuota {
  const q = getQuota();
  const next = { date: q.date, count: q.count + 1 };
  setQuota(next);
  return next;
}

// ---- transient OAuth state ----

export interface OAuthState {
  state: string;
  code_verifier: string;
  redirect_uri: string;
  created_at: number;
}

export function getOAuthState(): OAuthState | null {
  return read<OAuthState | null>(K.oauthState, null);
}

export function setOAuthState(s: OAuthState): void {
  write(K.oauthState, s);
}

export function clearOAuthState(): void {
  remove(K.oauthState);
}

// ---- wipe everything ----

export function wipeAll(): void {
  for (const key of Object.values(K)) remove(key);
}

// ---- helpers ----

function todayUtc(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
