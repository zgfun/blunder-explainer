import { inspect } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRateLimiter } from "../../rate-limit";
import { classifyUpstreamError, describeError } from "../upstream-error";
import { MAX_VISITOR_KEY_LENGTH, readVisitorKey, VISITOR_KEY_HEADER } from "../visitor-key";
import { fakeClient, fakeStream, GOOD_ANSWER, SCHOLAR_INPUT } from "./fixtures";

const state = vi.hoisted(() => ({
  serverClient: null as Anthropic | null,
  visitorClient: null as Anthropic | null,
  clientCalls: [] as (string | undefined)[],
  cached: null as { theme: string | null; text: string; model: string } | null,
  today: 0,
  todayReads: 0,
  saved: [] as { key: unknown; value: Record<string, unknown> }[],
  limiter: null as ReturnType<typeof createRateLimiter> | null,
  byokLimiter: null as ReturnType<typeof createRateLimiter> | null,
}));

vi.mock("../client", () => ({
  EXPLAIN_MODEL: "claude-sonnet-5-5",
  GRADER_MODEL: "claude-opus-5-5",
  getClient: (visitorKey?: string) => {
    state.clientCalls.push(visitorKey);
    return visitorKey ? state.visitorClient : state.serverClient;
  },
}));

vi.mock("../cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../cache")>()),
  findExplanation: vi.fn(async () => state.cached),
  countExplanationsToday: vi.fn(async () => {
    state.todayReads++;
    return state.today;
  }),
  saveExplanation: vi.fn(async (key: unknown, value: Record<string, unknown>) => {
    state.saved.push({ key, value });
  }),
}));

vi.mock("../../rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../rate-limit")>()),
  getRateLimiter: (kind = "server") => (kind === "byok" ? state.byokLimiter! : state.limiter!),
}));

const { POST } = await import("../../../app/api/explain/route");

const KEY = "sk-ant-api03-VisitorSecret_0123456789-abcdefXYZ";
const VALID = { ...SCHOLAR_INPUT, level: 1600 };

function post(headers: Record<string, string> = {}, body: unknown = VALID) {
  return POST(
    new Request("http://localhost/api/explain", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

const withKey = (key = KEY) => ({ [VISITOR_KEY_HEADER]: key });

async function settle() {
  await new Promise((r) => setTimeout(r, 0));
}

function apiError(status: number, type: string, message: string, headers: Record<string, string> = {}) {
  return Anthropic.APIError.generate(
    status,
    { type: "error", error: { type, message }, request_id: "req_test" },
    undefined,
    new Headers({ "request-id": "req_test", ...headers }),
  );
}

function failingClient(error: unknown) {
  return fakeClient(() => fakeStream([], {}, { failAfter: 0, error }));
}

beforeEach(() => {
  state.serverClient = null;
  state.visitorClient = null;
  state.clientCalls = [];
  state.cached = null;
  state.today = 0;
  state.todayReads = 0;
  state.saved = [];
  state.limiter = createRateLimiter({ perHour: 30, dailyCap: 500 });
  state.byokLimiter = createRateLimiter({ perHour: 120, dailyCap: Number.POSITIVE_INFINITY });
});

describe("readVisitorKey", () => {
  const read = (value?: string) => readVisitorKey(new Headers(value === undefined ? {} : { [VISITOR_KEY_HEADER]: value }));

  it("treats a missing or blank header as no key", () => {
    expect(read()).toEqual({ kind: "none" });
    expect(read("")).toEqual({ kind: "none" });
    expect(read("   ")).toEqual({ kind: "none" });
  });

  it("trims and accepts key-shaped values", () => {
    expect(read(`  ${KEY}  `)).toEqual({ kind: "key", key: KEY });
    expect(read("sk-ant-api03-fake")).toEqual({ kind: "key", key: "sk-ant-api03-fake" });
  });

  it("rejects over-long values and characters outside [A-Za-z0-9_-]", () => {
    expect(read("a".repeat(MAX_VISITOR_KEY_LENGTH))).toEqual({ kind: "key", key: "a".repeat(MAX_VISITOR_KEY_LENGTH) });
    expect(read("a".repeat(MAX_VISITOR_KEY_LENGTH + 1))).toEqual({ kind: "malformed" });
    for (const bad of ["sk-ant key", "sk-ant-api03-x;y", "sk-ant-api03-xé", "Bearer sk-ant", "sk-ant/../x", "sk.ant"]) {
      expect(read(bad)).toEqual({ kind: "malformed" });
    }
  });
});

describe("classifyUpstreamError", () => {
  it("maps the SDK's typed errors to what a visitor can act on", () => {
    expect(classifyUpstreamError(apiError(401, "authentication_error", "invalid x-api-key"))).toEqual({ kind: "invalid-key" });
    expect(classifyUpstreamError(apiError(402, "billing_error", "payment required"))).toEqual({ kind: "insufficient-credit" });
    expect(classifyUpstreamError(apiError(403, "permission_error", "not allowed"))).toEqual({ kind: "insufficient-credit" });
    expect(
      classifyUpstreamError(
        apiError(400, "invalid_request_error", "Your credit balance is too low to access the Anthropic API."),
      ),
    ).toEqual({ kind: "insufficient-credit" });
    expect(classifyUpstreamError(apiError(429, "rate_limit_error", "slow down", { "retry-after": "17" }))).toEqual({
      kind: "provider-rate-limited",
      retryAfter: 17,
    });
    expect(classifyUpstreamError(apiError(429, "rate_limit_error", "slow down"))).toEqual({
      kind: "provider-rate-limited",
      retryAfter: 60,
    });
    expect(classifyUpstreamError(apiError(529, "overloaded_error", "Overloaded"))).toEqual({ kind: "overloaded" });
    expect(classifyUpstreamError(apiError(400, "invalid_request_error", "messages: bad"))).toEqual({ kind: "upstream" });
    expect(classifyUpstreamError(apiError(500, "api_error", "boom"))).toEqual({ kind: "upstream" });
    expect(classifyUpstreamError(new Anthropic.APIConnectionError({ message: "offline" }))).toEqual({ kind: "upstream" });
    expect(classifyUpstreamError(new Error("socket hang up"))).toEqual({ kind: "upstream" });
  });

  it("describes errors without the key, even when a message contains it", () => {
    const err = apiError(401, "authentication_error", `invalid x-api-key ${KEY}`);
    const line = describeError(err, [KEY]);
    expect(line).toContain("status=401");
    expect(line).toContain("type=authentication_error");
    expect(line).not.toContain(KEY);
    expect(describeError(new Error(`leaked ${KEY}`))).not.toContain(KEY);
    expect(describeError(new Error("leaked sk-ant-other_key-123"))).not.toContain("sk-ant-other_key-123");
  });
});

describe("POST /api/explain key precedence", () => {
  it("serves a cached explanation to anyone, without creating any client", async () => {
    state.cached = { theme: null, text: "Cached.", model: "m" };
    state.serverClient = fakeClient(() => fakeStream([GOOD_ANSWER])).client;
    for (const headers of [{}, withKey(), withKey("not a key!")]) {
      const res = await post(headers);
      expect(res.status).toBe(200);
      expect(res.headers.get("x-cache")).toBe("hit");
    }
    expect(state.clientCalls).toEqual([]);
  });

  it("uses the visitor's key before the server's", async () => {
    const server = fakeClient(() => fakeStream([GOOD_ANSWER]));
    const visitor = fakeClient(() => fakeStream([GOOD_ANSWER]));
    state.serverClient = server.client;
    state.visitorClient = visitor.client;
    const res = await post(withKey(`  ${KEY} `));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(GOOD_ANSWER);
    expect(state.clientCalls).toEqual([KEY]);
    expect(visitor.stream).toHaveBeenCalledTimes(1);
    expect(server.stream).not.toHaveBeenCalled();
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("falls back to the server key without a visitor key", async () => {
    const server = fakeClient(() => fakeStream([GOOD_ANSWER]));
    state.serverClient = server.client;
    expect((await post()).status).toBe(200);
    expect(state.clientCalls).toEqual([undefined]);
    expect(server.stream).toHaveBeenCalledTimes(1);
  });

  it("asks for a key when neither is available", async () => {
    const res = await post();
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ error: "explanations-unavailable", needsKey: true });
  });

  it("rejects a malformed key header on a cache miss without calling anyone", async () => {
    state.serverClient = fakeClient(() => fakeStream([GOOD_ANSWER])).client;
    const res = await post(withKey("sk-ant-api03-x;drop"));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "malformed-key" });
    expect(state.clientCalls).toEqual([]);
  });

  it("caches visitor-key explanations in the shared cache, marked as visitor-paid", async () => {
    state.visitorClient = fakeClient(() => fakeStream([GOOD_ANSWER])).client;
    await (await post(withKey())).text();
    await settle();
    expect(state.saved).toHaveLength(1);
    expect(state.saved[0].value).toMatchObject({ rawText: GOOD_ANSWER, paidBy: "visitor" });
    expect(JSON.stringify(state.saved)).not.toContain(KEY);
  });
});

describe("POST /api/explain visitor-key errors", () => {
  it.each([
    ["401 invalid key", apiError(401, "authentication_error", "invalid x-api-key"), 401, { error: "invalid-key" }],
    ["402 billing", apiError(402, "billing_error", "billing"), 402, { error: "insufficient-credit" }],
    ["403 permission", apiError(403, "permission_error", "nope"), 402, { error: "insufficient-credit" }],
    [
      "400 credit balance",
      apiError(400, "invalid_request_error", "Your credit balance is too low to access the Anthropic API."),
      402,
      { error: "insufficient-credit" },
    ],
    [
      "429 rate limit",
      apiError(429, "rate_limit_error", "Number of requests has exceeded your rate limit", { "retry-after": "42" }),
      429,
      { error: "provider-rate-limited", retryAfter: 42 },
    ],
    ["529 overloaded", apiError(529, "overloaded_error", "Overloaded"), 503, { error: "provider-overloaded", retryable: true }],
    ["500 api error", apiError(500, "api_error", "Internal"), 502, { error: "upstream" }],
  ])("maps %s", async (_, error, status, body) => {
    state.visitorClient = failingClient(error).client;
    const res = await post(withKey());
    expect(res.status).toBe(status);
    expect(await res.json()).toMatchObject(body);
    if (status === 429) expect(res.headers.get("retry-after")).toBe("42");
  });

  it("does not blame the visitor when the server key is rejected", async () => {
    state.serverClient = failingClient(apiError(401, "authentication_error", "invalid x-api-key")).client;
    const res = await post();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "explanations-unavailable", needsKey: true });
  });
});

describe("POST /api/explain rate limits with a visitor key", () => {
  it("does not apply or consume the daily cap for visitor-key calls", async () => {
    state.visitorClient = fakeClient(() => fakeStream([GOOD_ANSWER])).client;
    state.serverClient = fakeClient(() => fakeStream([GOOD_ANSWER])).client;
    state.today = 500;
    state.limiter = createRateLimiter({ perHour: 30, dailyCap: 1 });

    for (let i = 0; i < 3; i++) {
      const res = await post(withKey());
      expect(res.status).toBe(200);
      await res.text();
    }
    expect(state.todayReads).toBe(0);
    // The server limiter's daily budget is untouched; its own cap still applies to server-key calls.
    expect(state.limiter.consume("other").ok).toBe(true);
    state.today = 0;
    state.limiter.reset();
    const server = await post();
    expect(server.status).toBe(200);
    await server.text();
  });

  it("still limits visitor-key calls per IP", async () => {
    state.visitorClient = fakeClient(() => fakeStream([GOOD_ANSWER])).client;
    state.byokLimiter = createRateLimiter({ perHour: 1, dailyCap: Number.POSITIVE_INFINITY });
    const headers = { ...withKey(), "x-forwarded-for": "9.9.9.9" };
    expect((await post(headers)).status).toBe(200);
    const res = await post(headers);
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: "rate-limited", reason: "ip" });
  });

  it("returns needsKey with the daily-cap 429 so the visitor can bring a key", async () => {
    state.serverClient = fakeClient(() => fakeStream([GOOD_ANSWER])).client;
    state.today = 500;
    const res = await post();
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ reason: "daily", needsKey: true });
  });
});

describe("the visitor key never leaks", () => {
  const methods = ["log", "info", "warn", "error", "debug", "trace"] as const;
  let spies: ReturnType<typeof vi.spyOn>[] = [];

  beforeEach(() => {
    spies = methods.map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
  });
  afterEach(() => {
    for (const s of spies) s.mockRestore();
  });

  function logged(): string {
    return spies.flatMap((s) => s.mock.calls.map((args: unknown[]) => args.map((a) => inspect(a, { depth: 10 })).join(" "))).join("\n");
  }

  async function bodyText(res: Response): Promise<string> {
    try {
      return await res.text();
    } catch {
      return "";
    }
  }

  it("is absent from logs, responses and cache rows on every path", async () => {
    // An SDK error whose message and cause both carry the key, the worst case for a careless log.
    const leaky = apiError(401, "authentication_error", `invalid x-api-key: ${KEY}`);
    (leaky as Error & { cause?: unknown }).cause = { headers: { "x-api-key": KEY } };
    const scenarios: (() => Anthropic)[] = [
      () => failingClient(leaky).client,
      () => failingClient(apiError(429, "rate_limit_error", "slow")).client,
      () => failingClient(new Error(`connect failed for ${KEY}`)).client,
      () => fakeClient(() => fakeStream(["Hello", " world"], {}, { failAfter: 1, error: new Error(`mid-stream ${KEY}`) })).client,
      () => fakeClient(() => fakeStream(["cut"], { stop_reason: "max_tokens" })).client,
      () => fakeClient(() => fakeStream([GOOD_ANSWER])).client,
    ];
    const outputs: string[] = [];
    for (const make of scenarios) {
      state.visitorClient = make();
      const res = await post(withKey());
      outputs.push(JSON.stringify([...res.headers]), await bodyText(res));
    }
    outputs.push(await bodyText(await post(withKey("bad key!"))));
    await settle();

    expect(spies.some((s) => s.mock.calls.length > 0)).toBe(true);
    expect(logged()).not.toContain(KEY);
    expect(outputs.join("\n")).not.toContain(KEY);
    expect(JSON.stringify(state.saved)).not.toContain(KEY);
  });
});

describe("x-anthropic-key on other routes", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is never forwarded or echoed by the game routes", async () => {
    const outgoing: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        outgoing.push(String(input), JSON.stringify([...new Headers(init?.headers)]), String(init?.body ?? ""));
        return new Response(JSON.stringify({ code: 0, message: "not found" }), { status: 404 });
      }),
    );
    const { GET: getGames } = await import("../../../app/api/games/route");
    const { GET: getGame } = await import("../../../app/api/game/route");
    const responses = [
      await getGames(new Request("http://localhost/api/games?username=hikaru", { headers: withKey() })),
      await getGame(new Request("http://localhost/api/game?sample=1", { headers: withKey() })),
    ];
    const texts = await Promise.all(responses.map(async (r) => JSON.stringify([...r.headers]) + (await r.text())));
    expect(outgoing.length).toBeGreaterThan(0);
    expect(outgoing.join("\n")).not.toContain(KEY);
    expect(texts.join("\n")).not.toContain(KEY);
  });

  it("is read only by the explain route", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const apiDir = join(process.cwd(), "app", "api");
    for (const route of readdirSync(apiDir)) {
      if (route === "explain") continue;
      const source = readFileSync(join(apiDir, route, "route.ts"), "utf8");
      expect(source).not.toMatch(/x-anthropic-key|visitor-key|VISITOR_KEY_HEADER/i);
    }
  });
});
