import Anthropic from "@anthropic-ai/sdk";

export type UpstreamFailure =
  | { kind: "invalid-key" }
  | { kind: "insufficient-credit" }
  | { kind: "provider-rate-limited"; retryAfter: number }
  | { kind: "overloaded" }
  | { kind: "upstream" };

const DEFAULT_RETRY_AFTER = 60;

function retryAfterSeconds(headers: Headers | undefined): number {
  const value = headers?.get("retry-after");
  const n = value ? Number.parseInt(value, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.min(n, 3600) : DEFAULT_RETRY_AFTER;
}

/** Maps an Anthropic SDK error to what the visitor can act on, using the SDK's typed classes. */
export function classifyUpstreamError(err: unknown): UpstreamFailure {
  if (err instanceof Anthropic.AuthenticationError) return { kind: "invalid-key" };
  if (err instanceof Anthropic.RateLimitError) return { kind: "provider-rate-limited", retryAfter: retryAfterSeconds(err.headers) };
  if (err instanceof Anthropic.PermissionDeniedError) return { kind: "insufficient-credit" };
  if (err instanceof Anthropic.APIConnectionError) return { kind: "upstream" };
  if (err instanceof Anthropic.APIError) {
    if (err.status === 402 || err.type === "billing_error") return { kind: "insufficient-credit" };
    // A key with no credit left gets a 400 invalid_request_error saying so.
    if (err instanceof Anthropic.BadRequestError && /credit balance/i.test(err.message)) return { kind: "insufficient-credit" };
    if (err.status === 529 || err.type === "overloaded_error") return { kind: "overloaded" };
  }
  return { kind: "upstream" };
}

// Anything shaped like an Anthropic key, as a backstop to redacting the known secrets.
const KEY_LIKE_RE = /sk-ant-[A-Za-z0-9_-]+/g;

/**
 * A one-line description of an error that is safe to log: status, type, request id and message
 * only. Never the error object itself (it carries headers and causes), and known secrets plus
 * anything that looks like a key are redacted from the message.
 */
export function describeError(err: unknown, secrets: (string | null | undefined)[] = []): string {
  let out: string;
  if (err instanceof Anthropic.APIError) {
    out = `${err.name} status=${err.status ?? "-"} type=${err.type ?? "-"} request=${err.requestID ?? "-"}: ${err.message}`;
  } else if (err instanceof Error) {
    out = `${err.name}: ${err.message}`;
  } else {
    out = typeof err === "string" ? err : "non-error value thrown";
  }
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join("[redacted]");
  }
  return out.replace(KEY_LIKE_RE, "[redacted]").slice(0, 500);
}
