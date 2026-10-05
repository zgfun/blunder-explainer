import Anthropic from "@anthropic-ai/sdk";

export const EXPLAIN_MODEL = "claude-sonnet-5-5";
export const GRADER_MODEL = "claude-opus-5-5";

/** Where a visitor's key is sent, whatever the server's environment says. */
export const VISITOR_BASE_URL = "https://api.anthropic.com";

let cached: { key: string; client: Anthropic } | null = null;

/**
 * Header names the SDK would add to every request from ANTHROPIC_CUSTOM_HEADERS (one
 * "Name: value" per line). A visitor client sets each to null so none of them is sent.
 */
function envCustomHeaderNames(): string[] {
  const raw = process.env.ANTHROPIC_CUSTOM_HEADERS;
  if (!raw) return [];
  return raw
    .split("\n")
    .map((line) => (line.includes(":") ? line.slice(0, line.indexOf(":")).trim() : ""))
    .filter(Boolean);
}

/**
 * With `visitorKey`, a fresh client for that one request: never cached in module scope, so a
 * visitor's key does not outlive their request. Without it, the server's client, or null when
 * ANTHROPIC_API_KEY is unset so callers can degrade instead of throwing.
 */
export function getClient(visitorKey?: string): Anthropic | null {
  if (visitorKey) {
    // A visitor's key goes to Anthropic and nowhere else: the destination is pinned (no
    // ANTHROPIC_BASE_URL gateway or proxy), server-side ANTHROPIC_CUSTOM_HEADERS are dropped,
    // authToken: null keeps a server ANTHROPIC_AUTH_TOKEN out, and the SDK's own logging is off.
    return new Anthropic({
      apiKey: visitorKey,
      authToken: null,
      baseURL: VISITOR_BASE_URL,
      defaultHeaders: Object.fromEntries(envCustomHeaderNames().map((name) => [name, null])),
      logLevel: "off",
      maxRetries: 1,
    });
  }
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return null;
  if (cached?.key !== key) cached = { key, client: new Anthropic({ apiKey: key }) };
  return cached.client;
}
