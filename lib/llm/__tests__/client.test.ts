import { afterEach, describe, expect, it, vi } from "vitest";
import { getClient, VISITOR_BASE_URL } from "../client";

const KEY = "sk-ant-api03-VisitorSecret_0123456789";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("getClient with a visitor key", () => {
  it("sends the key only to api.anthropic.com, whatever the environment says", async () => {
    vi.stubEnv("ANTHROPIC_BASE_URL", "http://127.0.0.1:9/gateway");
    vi.stubEnv("ANTHROPIC_CUSTOM_HEADERS", "x-gateway-token: server-secret\nX-Other: two");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "server-auth-token");
    const calls: { url: string; headers: Headers }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        calls.push({ url: String(url), headers: new Headers(init?.headers) });
        return Response.json(
          { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } },
          { status: 401 },
        );
      }),
    );

    const client = getClient(KEY)!;
    expect(client.baseURL).toBe(VISITOR_BASE_URL);
    await expect(
      client.messages.create({ model: "claude-sonnet-5-5", max_tokens: 1, messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow();

    expect(calls).toHaveLength(1);
    expect(new URL(calls[0].url).origin).toBe("https://api.anthropic.com");
    expect(calls[0].headers.get("x-api-key")).toBe(KEY);
    expect(calls[0].headers.get("x-gateway-token")).toBeNull();
    expect(calls[0].headers.get("x-other")).toBeNull();
    expect(calls[0].headers.get("authorization")).toBeNull();
  });

  it("still honours ANTHROPIC_BASE_URL for the server's own key", () => {
    vi.stubEnv("ANTHROPIC_BASE_URL", "http://127.0.0.1:9/gateway");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-server-key");
    expect(getClient()!.baseURL).toBe("http://127.0.0.1:9/gateway");
  });
});
