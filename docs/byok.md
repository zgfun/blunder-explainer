# Bring your own key (BYOK)

The site owner doesn't pay for visitors' explanations. `ANTHROPIC_API_KEY` is optional; visitors
can paste their own Anthropic API key and each new explanation is billed to them.

## Flow

1. **Browser.** The key is entered in the key dialog (header key icon, or the call to action in a
   card). It is kept in `localStorage` ("Remember on this device", the default) or `sessionStorage`
   (unticked), always behind `try/catch`. It is sent only as the `x-anthropic-key` header on
   `POST /api/explain`: never in a URL or body, never to another route.
2. **Server** (`app/api/explain/route.ts`), in this order:
   1. Cached explanation in Postgres: served to anyone, no key needed, the header is not even read.
   2. Visitor key, if the header is present: trimmed, at most 300 chars of `[A-Za-z0-9_-]`
      (`lib/llm/visitor-key.ts`), otherwise `400 malformed-key` (Anthropic is not contacted).
   3. Server key, if configured.
   4. Otherwise `503 {error: "explanations-unavailable", needsKey: true}`, and the UI shows the key
      call to action.
3. A visitor key gets a fresh `Anthropic` client for that request (`getClient(visitorKey)`; never
   cached in module scope, `authToken: null` so no server credential rides along). Visitor keys are
   only ever sent to `https://api.anthropic.com`, whatever the environment says: the client pins
   `baseURL` (so an `ANTHROPIC_BASE_URL` gateway or logging proxy never sees them), drops every
   header from `ANTHROPIC_CUSTOM_HEADERS`, and turns the SDK's own logging off. The server's own
   key still honours those variables.
4. The result is written to the shared explanations cache (plain text, same key as before, with
   `paid_by = 'visitor'`). Other visitors analysing the same position get it for free. Only chess
   positions are involved, so no personal data is stored.

## Limits

- The global `DAILY_LLM_CAP` protects the owner's budget, so it counts only `paid_by = 'server'`
  rows and is not checked for visitor-key calls.
- Visitor-key calls have their own per-IP hourly limit (`RATE_LIMIT_PER_HOUR_BYOK`, default 120)
  so the route can't be used as a free Claude proxy at scale. The prompt is built only from
  server-derived chess data, which limits what a proxy could be used for anyway.

## Errors

Anthropic errors are mapped with the SDK's typed classes (`lib/llm/upstream-error.ts`):

| Anthropic | Response |
| --- | --- |
| 401 `AuthenticationError` | `401 invalid-key` (dialog reopens with an explanation) |
| 402 / `billing_error`, 403, 400 "credit balance is too low" | `402 insufficient-credit` |
| 429 `RateLimitError` | `429 provider-rate-limited` with `retryAfter` |
| 529 / `overloaded_error` | `503 provider-overloaded`, `retryable: true` |
| anything else | `502 upstream` |

When the *server* key gets a 401 or a billing error, the visitor is asked for their own key
instead (`503 needsKey`): it's not their key that is wrong.

## Threat model

- **The key passes through our server**, in memory, for one request. That requires trusting the
  deployment. Mitigations: HTTPS only; the key is never stored, never put in a response or a cache
  row, and never logged. Errors are logged as `status/type/request id/message` only (never the
  error object, which carries headers and causes), with the key and anything shaped like
  `sk-ant-…` redacted. Responses are `Cache-Control: no-store`. Tests spy on `console.*` across
  every failure path and assert the key never appears.
- **In the browser**, the key is readable by any script on the origin (as with any token in web
  storage). The site loads no third-party scripts. Visitors who prefer not to persist it can untick
  "Remember on this device" or use "Forget key", and can revoke it any time in the Anthropic
  Console. A spending limit on the key's workspace is a good idea.
- **Rejected alternative: calling Anthropic straight from the browser** with the
  `anthropic-dangerous-direct-browser-access` header. The key would never touch our server, but:
  - the server must build the grounded prompt from server-derived engine data (the client sends
    only a FEN, UCI moves and numbers), so the browser could otherwise send any prompt; and
  - the server must be the one writing the shared cache. If browsers generated text and uploaded
    it, anyone could poison the cache that other visitors read.
