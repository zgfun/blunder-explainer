import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Blunder } from "@/lib/chess/types";

/**
 * A minimal synchronous stand-in for React's hooks (there is no DOM test renderer in this
 * project), enough to drive useExplanation: state, effects with deps, callbacks and the key store.
 */
const h = vi.hoisted(() => {
  type Slot = { value?: unknown; deps?: unknown[]; cleanup?: (() => void) | void };
  const r = {
    slots: [] as Slot[],
    index: 0,
    dirty: false,
    rendering: false,
    pending: [] as (() => void)[],
    render: null as null | (() => void),
  };
  const slot = () => (r.slots[r.index] ??= {}) && r.slots[r.index++];
  const react = {
    useState<T>(init: T | (() => T)) {
      const s = slot();
      if (!("value" in s)) s.value = typeof init === "function" ? (init as () => T)() : init;
      const set = (next: T | ((prev: T) => T)) => {
        s.value = typeof next === "function" ? (next as (prev: T) => T)(s.value as T) : next;
        if (r.rendering) r.dirty = true;
        else r.render?.();
      };
      return [s.value as T, set] as const;
    },
    useEffect(fn: () => (() => void) | void, deps: unknown[]) {
      const s = slot();
      if (s.deps && deps.every((d, i) => Object.is(d, s.deps![i]))) return;
      s.deps = deps;
      r.pending.push(() => {
        if (typeof s.cleanup === "function") s.cleanup();
        s.cleanup = fn();
      });
    },
    useCallback<T>(fn: T) {
      slot();
      return fn;
    },
    useSyncExternalStore<T>(subscribe: (l: () => void) => () => void, get: () => T) {
      const s = slot();
      if (!s.cleanup) s.cleanup = subscribe(() => r.render?.());
      return get();
    },
  };
  return { r, react };
});

vi.mock("react", () => h.react);

type Hook = typeof import("../useExplanation").useExplanation;

function mount(hook: Hook, b: Blunder, level: 1000 | 1600 | 2200 = 1600) {
  h.r.slots = [];
  h.r.pending = [];
  let result!: ReturnType<Hook>;
  h.r.render = () => {
    do {
      h.r.dirty = false;
      h.r.rendering = true;
      h.r.index = 0;
      result = hook(b, level);
      h.r.rendering = false;
    } while (h.r.dirty);
    const effects = h.r.pending.splice(0);
    for (const run of effects) run();
  };
  h.r.render();
  return {
    get state() {
      return result;
    },
    unmount() {
      for (const s of h.r.slots) if (typeof s.cleanup === "function") s.cleanup();
      h.r.render = null;
    },
  };
}

function blunder(uci: string): Blunder {
  return {
    fenBefore: "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 2 3",
    uci,
    bestUci: "f3f7",
    pvUci: ["f3f7"],
    refutationUci: [],
    evalBeforePawns: 0.5,
    evalAfterPawns: -1,
  } as unknown as Blunder;
}

async function flush() {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
}

type Reply = { status: number; body: string; headers?: Record<string, string> };
const requests: { uci: string; key: string | null }[] = [];
let reply: (uci: string, key: string | null) => Reply;

beforeEach(() => {
  vi.resetModules();
  requests.length = 0;
  vi.stubGlobal("window", {});
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const headers = new Headers(init.headers);
      const uci = JSON.parse(String(init.body)).playedUci as string;
      const key = headers.get("x-anthropic-key");
      requests.push({ uci, key });
      const r = reply(uci, key);
      return new Response(r.body, { status: r.status, headers: r.headers });
    }),
  );
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const NEEDS_KEY: Reply = { status: 503, body: JSON.stringify({ error: "explanations-unavailable", needsKey: true }) };
const CACHED: Reply = { status: 200, body: "THEME: fork\nThe knight forks king and queen.", headers: { "x-cache": "hit" } };

describe("useExplanation", () => {
  it("still asks the server about other cards after one needs a key, so cached ones show", async () => {
    const { useExplanation } = await import("../useExplanation");
    reply = (uci) => (uci === "g8f6" ? CACHED : NEEDS_KEY);

    const a = mount(useExplanation, blunder("d7d6"));
    await flush();
    expect(a.state.status).toBe("needs-key");
    a.unmount();

    const b = mount(useExplanation, blunder("g8f6"));
    await flush();
    expect(b.state.status).toBe("done");
    expect(b.state.cached).toBe(true);
    expect(requests.map((r) => r.uci)).toEqual(["d7d6", "g8f6"]);
    b.unmount();
  });

  it("remembers a card's failure under the same key, and retries it once a key is added", async () => {
    const { useExplanation } = await import("../useExplanation");
    const { saveApiKey } = await import("../apiKey");
    reply = (_uci, key) => (key ? CACHED : NEEDS_KEY);

    const first = mount(useExplanation, blunder("d7d6"));
    await flush();
    expect(first.state.status).toBe("needs-key");
    first.unmount();

    const again = mount(useExplanation, blunder("d7d6"));
    await flush();
    expect(again.state.status).toBe("needs-key");
    expect(requests).toHaveLength(1);

    saveApiKey("sk-ant-api03-visitor", true);
    await flush();
    expect(again.state.status).toBe("done");
    expect(requests.map((r) => r.key)).toEqual([null, "sk-ant-api03-visitor"]);
    again.unmount();
  });

  it("sends a placeholder instead of an unusable key, and shows the malformed-key state", async () => {
    const { useExplanation } = await import("../useExplanation");
    const { saveApiKey, useApiKey, MALFORMED_KEY_PLACEHOLDER } = await import("../apiKey");
    saveApiKey("sk-ant-api03-abc–def", true);
    reply = () => ({ status: 400, body: JSON.stringify({ error: "malformed-key" }) });

    const card = mount(useExplanation, blunder("d7d6"));
    await flush();
    expect(requests).toEqual([{ uci: "d7d6", key: MALFORMED_KEY_PLACEHOLDER }]);
    expect(card.state.status).toBe("invalid-key");
    expect(card.state.keyReason).toBe("malformed-key");
    expect(card.state.message).toMatch(/letters, digits/);
    card.unmount();

    // The dialog opened to explain why.
    h.r.slots = [];
    h.r.index = 0;
    expect(useApiKey().dialog).toEqual({ open: true, reason: "malformed-key" });
  });
});
