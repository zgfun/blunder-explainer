const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export type RateLimitResult =
  | { ok: true }
  | { ok: false; reason: "ip" | "daily"; retryAfter: number /* seconds */ };

export type RateLimiterOptions = {
  perHour: number;
  dailyCap: number;
  now?: () => number;
};

/**
 * In-memory limits for fresh LLM calls: a sliding one-hour window per IP plus a cap per UTC day.
 * Both are per instance; the explain route also checks the day's total in Postgres, which holds
 * across instances and cold starts.
 */
export function createRateLimiter({ perHour, dailyCap, now = Date.now }: RateLimiterOptions) {
  const hits = new Map<string, number[]>();
  let day = -1;
  let dayCount = 0;

  function prune(t: number) {
    for (const [ip, times] of hits) {
      const kept = times.filter((x) => t - x < HOUR_MS);
      if (kept.length) hits.set(ip, kept);
      else hits.delete(ip);
    }
  }

  return {
    /** Checks both limits and, only if both pass, records the call. */
    consume(ip: string): RateLimitResult {
      const t = now();
      const today = Math.floor(t / DAY_MS);
      if (today !== day) {
        day = today;
        dayCount = 0;
      }
      if (hits.size > 10_000) prune(t);

      const times = (hits.get(ip) ?? []).filter((x) => t - x < HOUR_MS);
      if (times.length >= perHour) {
        hits.set(ip, times);
        return { ok: false, reason: "ip", retryAfter: Math.max(1, Math.ceil((times[0] + HOUR_MS - t) / 1000)) };
      }
      if (dayCount >= dailyCap) {
        return { ok: false, reason: "daily", retryAfter: Math.max(1, Math.ceil(((today + 1) * DAY_MS - t) / 1000)) };
      }
      times.push(t);
      hits.set(ip, times);
      dayCount++;
      return { ok: true };
    },
    reset() {
      hits.clear();
      day = -1;
      dayCount = 0;
    },
  };
}

export type RateLimiter = ReturnType<typeof createRateLimiter>;

function envInt(name: string, fallback: number): number {
  const n = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * Whose key pays for an explain call: the deployment's ("server") or the visitor's own ("byok").
 * "games" covers the game-loading routes, which call chess.com with this app's User-Agent.
 */
export type LimiterKind = "server" | "byok" | "games";

const shared: Partial<Record<LimiterKind, RateLimiter>> = {};

/**
 * Server-key calls get the per-IP limit and the global daily cap. Visitor-key calls cost the site
 * nothing, so they only get a (higher) per-IP limit that stops the route being a free proxy.
 */
export function getRateLimiter(kind: LimiterKind = "server"): RateLimiter {
  shared[kind] ??=
    kind === "byok"
      ? createRateLimiter({ perHour: envInt("RATE_LIMIT_PER_HOUR_BYOK", 120), dailyCap: Number.POSITIVE_INFINITY })
      : kind === "games"
        ? createRateLimiter({ perHour: envInt("RATE_LIMIT_PER_HOUR_GAMES", 60), dailyCap: Number.POSITIVE_INFINITY })
        : createRateLimiter({ perHour: envInt("RATE_LIMIT_PER_HOUR", 30), dailyCap: dailyCap() });
  return shared[kind];
}

/**
 * Per-IP limit for the game-loading routes (/api/game, /api/games). Returns a 429 response when the
 * caller is over it, otherwise null. Keeps the deployment from being used to hammer chess.com.
 */
export function limitGameRequest(request: Request): Response | null {
  const limit = getRateLimiter("games").consume(clientIp(request.headers));
  if (limit.ok) return null;
  return Response.json(
    { error: "too-many-requests", message: "Too many games loaded from your connection. Try again later.", retryAfter: limit.retryAfter },
    { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
  );
}

export type ClientIpOptions = {
  /** Proxies in front of the app that append to X-Forwarded-For (TRUSTED_PROXY_HOPS, default 1). */
  trustedHops?: number;
  /** On Vercel the platform sets x-real-ip itself and it can't be forged. */
  vercel?: boolean;
};

/**
 * The client IP for rate limiting. Never the left-most X-Forwarded-For entry: the client writes
 * that one. Each trusted proxy appends the address it saw, so the entry `trustedHops` from the
 * right is the last one a trusted party added. With no proxy (hops 0) every header is
 * client-controlled, so all callers share one bucket.
 */
export function clientIp(headers: Headers, opts: ClientIpOptions = {}): string {
  const vercel = opts.vercel ?? Boolean(process.env.VERCEL);
  const hops = opts.trustedHops ?? envInt("TRUSTED_PROXY_HOPS", 1);
  const forwarded = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (vercel) return headers.get("x-real-ip")?.trim() || forwarded.at(-1) || "unknown";
  if (hops <= 0) return "unknown";
  if (forwarded.length) return forwarded[Math.max(0, forwarded.length - hops)];
  return headers.get("x-real-ip")?.trim() || "unknown";
}

export function dailyCap(): number {
  return envInt("DAILY_LLM_CAP", 500);
}
