export interface CrawlResult {
  url: string;
  slug: string;
  article: import("./extract.js").Article;
}

const TRACKING_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "fbclid", "gclid", "gclsrc", "dclid", "msclkid",
  "mc_cid", "mc_eid", "yclid", "twclid",
]);

export function slugify(url: string): string {
  const u = new URL(url);
  const path = u.pathname.replace(/\/$/, "") || "/index";
  let slug = path
    .split("/")
    .filter(Boolean)
    .join("-")
    .replace(/[^a-z0-9-]/gi, "-")
    .replace(/-+/g, "-")
    .toLowerCase()
    || "index";

  // Append query fingerprint so different query params get different slugs
  if (u.search) {
    const sorted = new URLSearchParams(u.search);
    const parts: string[] = [];
    sorted.sort();
    for (const [k, v] of sorted) {
      parts.push(`${k}=${v}`);
    }
    if (parts.length > 0) {
      const fingerprint = parts.join("&")
        .replace(/[^a-z0-9]/gi, "-")
        .replace(/-+/g, "-")
        .toLowerCase()
        .slice(0, 60);
      slug += `-${fingerprint}`;
    }
  }

  return slug;
}

export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    // Strip hash
    u.hash = "";
    // Strip tracking params, sort the rest
    const params = new URLSearchParams(u.search);
    for (const key of [...params.keys()]) {
      if (TRACKING_PARAMS.has(key) || key.startsWith("utm_")) {
        params.delete(key);
      }
    }
    params.sort();
    u.search = params.toString();
    // Preserve trailing slash as-is (Django needs /path/ != /path)
    return u.toString();
  } catch {
    // Fallback for non-parseable URLs
    return raw.split("#")[0];
  }
}

export function dedupeSlug(slug: string, used: Set<string>): string {
  if (!used.has(slug)) {
    used.add(slug);
    return slug;
  }
  let n = 2;
  while (used.has(`${slug}-${n}`)) n++;
  const deduped = `${slug}-${n}`;
  used.add(deduped);
  return deduped;
}

/**
 * Track query-string variants per path. Returns true if this URL should be
 * accepted (under the cap), false if it should be skipped.
 */
const PATH_VARIANT_CAP = 10;

export function checkPathVariant(
  url: string,
  pathVariants: Map<string, number>,
): boolean {
  try {
    const u = new URL(url);
    const path = u.origin + u.pathname;
    const count = pathVariants.get(path) || 0;
    if (count >= PATH_VARIANT_CAP) return false;
    pathVariants.set(path, count + 1);
    return true;
  } catch {
    return true;
  }
}

/**
 * Global rate limiter. Tracks request start timestamps and enforces
 * aggregate rate across all concurrent tabs.
 */
export class RateLimiter {
  private timestamps: number[] = [];
  private rps: number;

  constructor(rps: number) {
    this.rps = rps;
  }

  async wait(): Promise<void> {
    if (this.rps <= 0) return; // unlimited
    const now = Date.now();
    const window = 1000; // 1 second window
    // Prune old timestamps
    this.timestamps = this.timestamps.filter((t) => now - t < window);
    if (this.timestamps.length >= this.rps) {
      const oldest = this.timestamps[0];
      const delay = window - (now - oldest);
      if (delay > 0) {
        await new Promise((r) => setTimeout(r, delay));
      }
      // Prune again after waiting
      const now2 = Date.now();
      this.timestamps = this.timestamps.filter((t) => now2 - t < window);
    }
    this.timestamps.push(Date.now());
  }
}

