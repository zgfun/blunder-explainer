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
 * In-memory limits for fresh LLM calls: a sliding one-hour window per IP plus a global cap
 * per UTC day. Per-instance only, which is enough to bound a portfolio demo's spend.
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

let shared: RateLimiter | null = null;

export function getRateLimiter(): RateLimiter {
  shared ??= createRateLimiter({
    perHour: envInt("RATE_LIMIT_PER_HOUR", 30),
    dailyCap: envInt("DAILY_LLM_CAP", 500),
  });
  return shared;
}

export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "unknown";
}
