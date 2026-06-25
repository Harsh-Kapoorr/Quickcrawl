/** Lightweight class-name joiner. */
export function cn(
  ...parts: Array<string | false | null | undefined>
): string {
  return parts.filter(Boolean).join(" ");
}

/** Parse a free-text block of URLs (newline/comma/space separated). */
export function parseUrlInput(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Cheap pre-filter so the UI can disable Submit before the backend round-trip. */
export function isLikelyUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Format an ISO timestamp into a short local string. */
export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/** Format an ISO timestamp into a relative string ("3m ago", "2h ago", "Mar 14"). */
export function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diff = (Date.now() - then) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return fmtTime(iso);
}

/** Truncate a URL to fit a small column. */
export function truncateMiddle(s: string, max = 48): string {
  if (s.length <= max) return s;
  const half = Math.floor((max - 1) / 2);
  return `${s.slice(0, half)}…${s.slice(-half)}`;
}

/** Match a URL against a Search Console property URL.
 *  - "sc-domain:example.com" matches the host (and any subdomain).
 *  - "https://example.com/" (URL-prefix) matches scheme + host + path-boundary.
 */
export function propertyMatchesUrl(propertyUrl: string, url: string): boolean {
  if (propertyUrl.startsWith("sc-domain:")) {
    const domain = propertyUrl.slice("sc-domain:".length).toLowerCase();
    let host: string;
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      return false;
    }
    return host === domain || host.endsWith("." + domain);
  }
  let prop: URL;
  let target: URL;
  try {
    prop = new URL(propertyUrl);
    target = new URL(url);
  } catch {
    return false;
  }
  if (prop.protocol !== target.protocol) return false;
  if (prop.hostname.toLowerCase() !== target.hostname.toLowerCase()) return false;
  const propPath = prop.pathname.replace(/\/+$/, "");
  if (!propPath) return true;
  return target.pathname === propPath || target.pathname.startsWith(propPath + "/");
}
