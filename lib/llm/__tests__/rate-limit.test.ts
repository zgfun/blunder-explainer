import { describe, expect, it } from "vitest";
import { clientIp, createRateLimiter } from "../../rate-limit";

const HOUR = 3600_000;

describe("createRateLimiter", () => {
  it("allows perHour calls per IP in a sliding window", () => {
    let t = Date.UTC(2026, 9, 5, 12);
    const rl = createRateLimiter({ perHour: 2, dailyCap: 100, now: () => t });
    expect(rl.consume("a").ok).toBe(true);
    t += 10 * 60_000;
    expect(rl.consume("a").ok).toBe(true);
    const blocked = rl.consume("a");
    expect(blocked).toEqual({ ok: false, reason: "ip", retryAfter: 50 * 60 });
    expect(rl.consume("b").ok).toBe(true);
    t += 50 * 60_000;
    expect(rl.consume("a").ok).toBe(true);
  });

  it("does not count rejected calls", () => {
    let t = 0;
    const rl = createRateLimiter({ perHour: 1, dailyCap: 100, now: () => t });
    rl.consume("a");
    for (let i = 0; i < 5; i++) rl.consume("a");
    t += HOUR;
    expect(rl.consume("a").ok).toBe(true);
  });

  it("enforces a global daily cap that resets at UTC midnight", () => {
    let t = Date.UTC(2026, 9, 5, 23, 0);
    const rl = createRateLimiter({ perHour: 100, dailyCap: 2, now: () => t });
    expect(rl.consume("a").ok).toBe(true);
    expect(rl.consume("b").ok).toBe(true);
    expect(rl.consume("c")).toEqual({ ok: false, reason: "daily", retryAfter: 3600 });
    t = Date.UTC(2026, 9, 6, 0, 0, 1);
    expect(rl.consume("c").ok).toBe(true);
  });
});

describe("clientIp", () => {
  it("takes the entry the trusted proxy appended, never the client-written left-most one", () => {
    const spoofed = new Headers({ "x-forwarded-for": "6.6.6.6, 1.2.3.4" });
    expect(clientIp(spoofed, { trustedHops: 1, vercel: false })).toBe("1.2.3.4");
    expect(clientIp(new Headers({ "x-forwarded-for": "6.6.6.6, 1.2.3.4, 10.0.0.1" }), { trustedHops: 2, vercel: false })).toBe("1.2.3.4");
    expect(clientIp(new Headers({ "x-forwarded-for": "1.2.3.4" }), { trustedHops: 3, vercel: false })).toBe("1.2.3.4");
  });

  it("uses x-real-ip on Vercel and as a fallback", () => {
    const h = new Headers({ "x-forwarded-for": "6.6.6.6", "x-real-ip": "5.6.7.8" });
    expect(clientIp(h, { vercel: true })).toBe("5.6.7.8");
    expect(clientIp(new Headers({ "x-real-ip": "5.6.7.8" }), { trustedHops: 1, vercel: false })).toBe("5.6.7.8");
  });

  it("puts everyone in one bucket when no proxy is trusted or nothing is known", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "1.2.3.4" }), { trustedHops: 0, vercel: false })).toBe("unknown");
    expect(clientIp(new Headers(), { trustedHops: 1, vercel: false })).toBe("unknown");
  });
});
