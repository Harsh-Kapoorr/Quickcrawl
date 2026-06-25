/** Client-side Google OAuth 2.0 + PKCE + direct Google API client.

All calls happen from the browser. The user's client_id / client_secret /
tokens are read from localStorage (via lib/store.ts) and sent directly to
Google's OAuth + Indexing + Search Console endpoints.

PKCE S256 + state CSRF. No server, no proxy.

Endpoint summary:
  Authorize:   https://accounts.google.com/o/oauth2/v2/auth
  Token:       https://oauth2.googleapis.com/token
  Userinfo:    https://openidconnect.googleapis.com/v1/userinfo
  Indexing:    https://indexing.googleapis.com/v3/urlNotifications:publish
  Sites:       https://www.googleapis.com/webmasters/v3/sites
  Inspection:  https://searchconsole.googleapis.com/v1/urlInspection/index:inspect
 */

import {
  bumpQuota,
  getCredentials,
  getOAuthState,
  getTokens,
  setOAuthState,
  setTokens,
  clearOAuthState,
  type StoredTokens,
} from "./store";

export const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
export const INDEXING_API_BASE = "https://indexing.googleapis.com/v3";
export const SEARCHCONSOLE_API_BASE = "https://searchconsole.googleapis.com/v1";
export const WEBMASTERS_API_BASE = "https://www.googleapis.com/webmasters/v3";

export const GOOGLE_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/indexing",
  "https://www.googleapis.com/auth/webmasters.readonly",
];

export class OAuthError extends Error {
  constructor(public code: string, message?: string) {
    super(message ?? code);
    this.name = "OAuthError";
  }
}

export class GoogleAPIError extends Error {
  constructor(
    public statusCode: number,
    public apiMessage: string,
  ) {
    super(`${statusCode}: ${apiMessage}`);
    this.name = "GoogleAPIError";
  }
}

// ---- PKCE / state ----

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomToken(bytes = 32): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return b64url(arr);
}

async function sha256b64url(s: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return b64url(new Uint8Array(digest));
}

/** Begin OAuth: persist PKCE+state and return the Google authorize URL. */
export async function startOAuth(redirectUri: string): Promise<string> {
  const creds = getCredentials();
  if (!creds) throw new OAuthError("no_credentials");

  const state = randomToken(32);
  const codeVerifier = randomToken(48);
  const codeChallenge = await sha256b64url(codeVerifier);

  setOAuthState({ state, code_verifier: codeVerifier, redirect_uri: redirectUri, created_at: Date.now() });

  const params = new URLSearchParams({
    response_type: "code",
    client_id: creds.client_id,
    redirect_uri: redirectUri,
    scope: GOOGLE_SCOPES.join(" "),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
  });
  return `${GOOGLE_AUTHORIZE_URL}?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
  id_token?: string;
}

export interface UserInfo {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

/** Handle Google redirecting back: parse code + state, exchange, persist. */
export async function completeOAuth(search: string): Promise<{ email?: string }> {
  const params = new URLSearchParams(search);
  const error = params.get("error");
  if (error) throw new OAuthError(error);
  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) throw new OAuthError("missing_params");

  const pending = getOAuthState();
  if (!pending || pending.state !== state) throw new OAuthError("invalid_state");
  if (Date.now() - pending.created_at > 10 * 60 * 1000) {
    clearOAuthState();
    throw new OAuthError("expired_state");
  }

  const creds = getCredentials();
  if (!creds) throw new OAuthError("no_credentials");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    code_verifier: pending.code_verifier,
    client_id: creds.client_id,
    client_secret: creds.client_secret,
    redirect_uri: pending.redirect_uri,
  });
  const resp = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new OAuthError("token_exchange_failed", `${resp.status}: ${text.slice(0, 200)}`);
  }
  const tokens = (await resp.json()) as TokenResponse;

  const userinfo = await fetchUserInfo(tokens.access_token);

  setTokens({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: new Date(Date.now() + Math.max((tokens.expires_in ?? 3600) - 60, 0) * 1000).toISOString(),
    scope: tokens.scope,
    token_type: tokens.token_type ?? "Bearer",
    email: userinfo.email,
    name: userinfo.name,
    picture: userinfo.picture,
    sub: userinfo.sub,
  });
  clearOAuthState();
  return { email: userinfo.email };
}

async function fetchUserInfo(accessToken: string): Promise<UserInfo> {
  const resp = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new OAuthError("userinfo_failed", `${resp.status}: ${text.slice(0, 200)}`);
  }
  return (await resp.json()) as UserInfo;
}

/** Refresh the access token using the stored refresh token + client_secret. */
async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const creds = getCredentials();
  if (!creds) throw new OAuthError("no_credentials");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: creds.client_id,
    client_secret: creds.client_secret,
  });
  const resp = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new OAuthError("refresh_failed", `${resp.status}: ${text.slice(0, 200)}`);
  }
  return (await resp.json()) as TokenResponse;
}

/** Return a valid access token, refreshing if near expiry. Throws if reauth needed. */
export async function getValidAccessToken(): Promise<string> {
  let tokens = getTokens();
  if (!tokens) throw new OAuthError("not_signed_in");
  if (new Date(tokens.expires_at).getTime() > Date.now() + 60_000) {
    return tokens.access_token;
  }
  if (!tokens.refresh_token) throw new OAuthError("reauth_required");

  const fresh = await refreshAccessToken(tokens.refresh_token);
  const merged = {
    access_token: fresh.access_token,
    refresh_token: fresh.refresh_token ?? tokens.refresh_token,
    expires_at: new Date(Date.now() + Math.max((fresh.expires_in ?? 3600) - 60, 0) * 1000).toISOString(),
    scope: fresh.scope ?? tokens.scope,
    token_type: fresh.token_type ?? tokens.token_type ?? "Bearer",
    email: tokens.email,
    name: tokens.name,
    picture: tokens.picture,
    sub: tokens.sub,
  };
  setTokens(merged);
  return getTokens()!.access_token;
}

export interface GoogleRequestOptions {
  method: "GET" | "POST" | "PUT" | "DELETE";
  url: string;
  jsonBody?: unknown;
  params?: Record<string, string | number | boolean | undefined>;
}

/** Make an authenticated request. Auto-refreshes once on 401. */
export async function googleRequest(opts: GoogleRequestOptions): Promise<Response> {
  const doRequest = async (token: string) => {
    let url = opts.url;
    if (opts.params) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(opts.params)) {
        if (v === undefined || v === null) continue;
        qs.set(k, String(v));
      }
      const s = qs.toString();
      if (s) url += (url.includes("?") ? "&" : "?") + s;
    }
    return fetch(url, {
      method: opts.method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(opts.jsonBody !== undefined ? { "Content-Type": "application/json" } : {}),
        Accept: "application/json",
      },
      body: opts.jsonBody !== undefined ? JSON.stringify(opts.jsonBody) : undefined,
    });
  };

  let token: string;
  try {
    token = await getValidAccessToken();
  } catch (e) {
    if (e instanceof OAuthError) throw new OAuthError("reauth_required");
    throw e;
  }

  let resp = await doRequest(token);
  if (resp.status !== 401) return resp;

  // Force a refresh + retry once.
  const stored = getTokens();
  if (!stored?.refresh_token) throw new OAuthError("reauth_required");
  try {
    await refreshAccessToken(stored.refresh_token);
    const fresh = getTokens();
    if (!fresh) throw new OAuthError("reauth_required");
    token = fresh.access_token;
  } catch {
    throw new OAuthError("reauth_required");
  }
  resp = await doRequest(token);
  if (resp.status === 401) throw new OAuthError("reauth_required");
  return resp;
}

/** Throw a GoogleAPIError with parsed detail if the response is non-2xx. */
export async function raiseForGoogleError(resp: Response): Promise<never> {
  let body: unknown = {};
  try {
    body = await resp.json();
  } catch {
    /* keep empty */
  }
  const obj = body as { error?: { message?: string } | string; error_description?: string };
  const message =
    (typeof obj.error === "object" && obj.error?.message) ||
    obj.error_description ||
    (typeof obj.error === "string" ? obj.error : JSON.stringify(body));
  throw new GoogleAPIError(resp.status, String(message));
}

// ---- High-level helpers ----

export interface SiteEntry {
  siteUrl: string;
  permissionLevel?: string;
}

/** Fetch verified Search Console sites for the signed-in user. */
export async function listSites(): Promise<SiteEntry[]> {
  const resp = await googleRequest({
    method: "GET",
    url: `${WEBMASTERS_API_BASE}/sites`,
  });
  if (!resp.ok) await raiseForGoogleError(resp);
  const data = (await resp.json()) as { siteEntry?: SiteEntry[] };
  return data.siteEntry ?? [];
}

export interface UrlInspectionResult {
  inspectionResult?: {
    indexStatusResult?: { verdict?: string };
    [k: string]: unknown;
  };
}

export async function inspectUrl(siteUrl: string, url: string): Promise<UrlInspectionResult> {
  const resp = await googleRequest({
    method: "POST",
    url: `${SEARCHCONSOLE_API_BASE}/urlInspection/index:inspect`,
    jsonBody: { inspectionUrl: url, siteUrl },
  });
  if (!resp.ok) await raiseForGoogleError(resp);
  return (await resp.json()) as UrlInspectionResult;
}

export interface PublishResponse {
  urlNotificationMetadata?: { latestUpdate?: { notifyTime?: string } };
}

/** Submit a single URL to the Indexing API. Throws GoogleAPIError on failure. */
export async function publishUrl(
  url: string,
  notifyType: "URL_UPDATED" | "URL_DELETED" = "URL_UPDATED",
): Promise<PublishResponse> {
  const resp = await googleRequest({
    method: "POST",
    url: `${INDEXING_API_BASE}/urlNotifications:publish`,
    jsonBody: { url, type: notifyType },
  });
  if (!resp.ok) await raiseForGoogleError(resp);
  // Record quota (we count the request, regardless of HTTP outcome).
  bumpQuota();
  return (await resp.json()) as PublishResponse;
}
