import { afterEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "blunder-explainer:anthropic-key";

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  };
}

async function load(win: object) {
  vi.resetModules();
  vi.stubGlobal("window", win);
  return import("../apiKey");
}

afterEach(() => vi.unstubAllGlobals());

describe("explainHeaders", () => {
  it("adds x-anthropic-key only when there is a key", async () => {
    const { explainHeaders } = await load({});
    expect(explainHeaders(null)).toEqual({ "content-type": "application/json" });
    expect(explainHeaders("sk-ant-x")).toEqual({ "content-type": "application/json", "x-anthropic-key": "sk-ant-x" });
  });
});

describe("keyFormatProblem", () => {
  it("applies the server's charset and length limits", async () => {
    const { keyFormatProblem } = await load({});
    expect(keyFormatProblem(" sk-ant-api03-abc_DEF-123 ")).toBeNull();
    expect(keyFormatProblem("")).toBeNull();
    expect(keyFormatProblem("sk-ant-api03-abc\u2013def")).toBe("charset");
    expect(keyFormatProblem("sk-ant-api03 abc")).toBe("charset");
    expect(keyFormatProblem("sk-ant-api03-abc.def")).toBe("charset");
    expect(keyFormatProblem(`sk-ant-${"a".repeat(300)}`)).toBe("too-long");
  });

  it("never puts an unusable key in a header, so fetch can't throw on it", async () => {
    const { explainHeaders, MALFORMED_KEY_PLACEHOLDER } = await load({});
    const headers = explainHeaders("sk-ant-api03-abc\u2013def");
    expect(headers["x-anthropic-key"]).toBe(MALFORMED_KEY_PLACEHOLDER);
    expect(() => new Headers(headers)).not.toThrow();
    const { readVisitorKey } = await import("@/lib/llm/visitor-key");
    expect(readVisitorKey(new Headers(headers))).toEqual({ kind: "malformed" });
  });
});

describe("looksLikeAnthropicKey", () => {
  it("is a soft format check", async () => {
    const { looksLikeAnthropicKey } = await load({});
    expect(looksLikeAnthropicKey(" sk-ant-api03-abc ")).toBe(true);
    expect(looksLikeAnthropicKey("sk-proj-abc")).toBe(false);
  });
});

describe("key storage", () => {
  it("remembers in localStorage by default and in sessionStorage otherwise", async () => {
    const localStorage = memoryStorage();
    const sessionStorage = memoryStorage();
    const store = await load({ localStorage, sessionStorage });
    expect(store.getApiKey()).toBeNull();

    store.saveApiKey("  sk-ant-one  ", true);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("sk-ant-one");
    expect(store.getApiKey()).toBe("sk-ant-one");
    const v1 = store.getKeyVersion();

    store.saveApiKey("sk-ant-two", false);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe("sk-ant-two");
    expect(store.getKeyVersion()).toBeGreaterThan(v1);

    store.forgetApiKey();
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(store.getApiKey()).toBeNull();
  });

  it("reads a remembered key on load", async () => {
    const store = await load({ localStorage: memoryStorage({ [STORAGE_KEY]: "sk-ant-saved" }), sessionStorage: memoryStorage() });
    expect(store.getApiKey()).toBe("sk-ant-saved");
  });

  it("keeps working in memory when storage throws", async () => {
    const blocked = {
      get localStorage(): Storage {
        throw new Error("SecurityError");
      },
      get sessionStorage(): Storage {
        throw new Error("SecurityError");
      },
    };
    const store = await load(blocked);
    expect(store.getApiKey()).toBeNull();
    store.saveApiKey("sk-ant-mem", true);
    expect(store.getApiKey()).toBe("sk-ant-mem");
  });
});
