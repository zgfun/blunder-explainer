import { after } from "next/server";
import { z } from "zod";
import { countExplanationsToday, findExplanation, formatExplanation, saveExplanation, type PaidBy } from "../../../lib/llm/cache";
import { getClient } from "../../../lib/llm/client";
import { DeriveError, deriveBlunder, MAX_PV_UCI } from "../../../lib/llm/derive";
import { ExplainError, explainStream, type ExplainResult } from "../../../lib/llm/explain";
import { validateExplanation } from "../../../lib/llm/grounding";
import { explanationKey, promptId } from "../../../lib/llm/key";
import { classifyUpstreamError, describeError } from "../../../lib/llm/upstream-error";
import { readVisitorKey } from "../../../lib/llm/visitor-key";
import { optional } from "../../../lib/optional";
import { clientIp, dailyCap, getRateLimiter } from "../../../lib/rate-limit";
import type { Blunder } from "../../../lib/chess/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const CACHE_READ_MS = 1500;
const CACHE_WRITE_MS = 5000;

const Uci = z.string().regex(/^[a-h][1-8][a-h][1-8][qrbn]?$/, "must be a UCI move like e2e4");
const Cp = z.number().min(-100000).max(100000);

// Only a FEN, UCI moves and numbers are accepted: no client-provided text can reach the prompt.
const Body = z.object({
  fenBefore: z.string().min(15).max(100),
  playedUci: Uci,
  level: z.union([z.literal(1000), z.literal(1600), z.literal(2200)]),
  bestUci: Uci,
  pvUci: z.array(Uci).max(MAX_PV_UCI).default([]),
  refutationUci: z.array(Uci).max(MAX_PV_UCI).default([]),
  evalBeforeCp: Cp,
  evalAfterCp: Cp,
});

const TEXT_HEADERS = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" };

function json(status: number, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function rateLimited(error: string, retryAfter: number, extra: Record<string, unknown> = {}) {
  return json(429, { error, retryAfter, ...extra }, { "Retry-After": String(retryAfter) });
}

const NEEDS_KEY = {
  error: "explanations-unavailable",
  needsKey: true,
  message: "Explanations use your own Anthropic API key. Add one to get an explanation for this move.",
};

/** The JSON error for a failed upstream call. Key problems are the visitor's to fix only with their key. */
function upstreamResponse(err: unknown, paidBy: PaidBy): Response {
  const failure = classifyUpstreamError(err);
  switch (failure.kind) {
    case "invalid-key":
      if (paidBy === "server") return json(503, NEEDS_KEY);
      return json(401, { error: "invalid-key", message: "Anthropic did not accept this API key." });
    case "insufficient-credit":
      if (paidBy === "server") return json(503, NEEDS_KEY);
      return json(402, {
        error: "insufficient-credit",
        message: "This Anthropic account has no credit left, or the key is not allowed to use this model.",
      });
    case "provider-rate-limited":
      return rateLimited("provider-rate-limited", failure.retryAfter, { message: "Anthropic is rate-limiting this key." });
    case "overloaded":
      return json(503, { error: "provider-overloaded", retryable: true, message: "Anthropic is overloaded right now." });
    default:
      return json(502, { error: "upstream", message: "The explanation service failed. Please try again." });
  }
}

function secondsToUtcMidnight(now = Date.now()): number {
  const day = 86_400_000;
  return Math.max(1, Math.ceil((Math.floor(now / day + 1) * day - now) / 1000));
}

/** after() needs a Next request scope; outside one (unit tests, scripts) just start the work. */
function runAfterResponse(task: () => Promise<void>) {
  try {
    after(task);
  } catch {
    void task();
  }
}

export async function POST(request: Request): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json(400, { error: "invalid-json", message: "Request body must be JSON." });
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return json(400, { error: "invalid-request", message: z.prettifyError(parsed.error) });
  }
  const { level, ...input } = parsed.data;

  let blunder: Blunder;
  try {
    blunder = deriveBlunder(input);
  } catch (err) {
    if (err instanceof DeriveError) return json(400, { error: err.code, message: err.message });
    throw err;
  }

  // The key hashes the exact prompt, so a request with different engine data never shares a row.
  const key = explanationKey(blunder, level);
  const headers = { ...TEXT_HEADERS, "X-Prompt-Version": promptId() };

  const hit = await optional(() => findExplanation(key), CACHE_READ_MS, "explain cache lookup");
  if (hit) {
    return new Response(formatExplanation(hit.theme, hit.text), { headers: { ...headers, "X-Cache": "hit" } });
  }

  // Precedence after the cache: the visitor's own key, then the server's, else ask for a key.
  const visitor = readVisitorKey(request.headers);
  if (visitor.kind === "malformed") {
    // Distinct from invalid-key: Anthropic was never asked, the key just can't be one.
    return json(400, {
      error: "malformed-key",
      message: "That does not look like a complete Anthropic API key: it can only contain letters, digits, - and _.",
    });
  }
  const visitorKey = visitor.kind === "key" ? visitor.key : undefined;
  const paidBy: PaidBy = visitorKey ? "visitor" : "server";

  const client = getClient(visitorKey);
  if (!client) return json(503, NEEDS_KEY);

  if (paidBy === "server") {
    // The global daily cap protects the site's own budget, so only server-key calls count toward it.
    const cap = dailyCap();
    const today = await optional(() => countExplanationsToday(), CACHE_READ_MS, "explain daily count");
    if (today !== undefined && today >= cap) {
      return rateLimited("rate-limited", secondsToUtcMidnight(), { reason: "daily", needsKey: true });
    }
  }
  const limit = getRateLimiter(paidBy === "visitor" ? "byok" : "server").consume(clientIp(request.headers));
  if (!limit.ok) {
    return rateLimited("rate-limited", limit.retryAfter, { reason: limit.reason, needsKey: limit.reason === "daily" });
  }

  const stream = explainStream(blunder, level, { client, signal: request.signal });
  const iterator = stream[Symbol.asyncIterator]();

  // Pull the first delta before committing to a 200, so upstream failures still get a JSON error.
  let first: IteratorResult<string>;
  try {
    first = await iterator.next();
  } catch (err) {
    if (err instanceof ExplainError && err.code === "refusal") {
      return json(422, { error: "refused", message: "No explanation could be generated for this position." });
    }
    // Log a description only: the error object can carry request details, and the key never goes to logs.
    console.error("[explain] upstream error:", describeError(err, [visitorKey]));
    return upstreamResponse(err, paidBy);
  }

  runAfterResponse(async () => {
    const result = await stream.result.catch(() => null);
    if (result && !result.truncated) await persist(result);
  });

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      if (first.done) await finish(controller);
      else controller.enqueue(encoder.encode(first.value));
    },
    async pull(controller) {
      if (first.done) return;
      try {
        const next = await iterator.next();
        if (next.done) await finish(controller);
        else controller.enqueue(encoder.encode(next.value));
      } catch (err) {
        if (request.signal.aborted) return;
        console.error("[explain] stream interrupted:", describeError(err, [visitorKey]));
        // Erroring the body (instead of closing it) tells the client the text is incomplete.
        controller.error(new Error("explanation interrupted"));
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });

  async function finish(controller: ReadableStreamDefaultController<Uint8Array>) {
    const result = await stream.result.catch((err: unknown) => {
      console.warn("[explain] incomplete:", describeError(err, [visitorKey]));
      return null;
    });
    if (!result || result.truncated) {
      if (result) console.warn("[explain] hit max_tokens; not cached");
      controller.error(new Error("explanation incomplete"));
      return;
    }
    controller.close();
  }

  async function persist(result: ExplainResult) {
    const check = validateExplanation(result.text, blunder);
    if (!check.ok) console.warn("[explain] grounding problems:", check.problems.join("; "));
    await optional(
      () =>
        saveExplanation(key, {
          rawText: result.text,
          model: result.model,
          inputTokens: result.inputTokens + result.cacheReadTokens + result.cacheWriteTokens,
          outputTokens: result.outputTokens,
          paidBy,
        }),
      CACHE_WRITE_MS,
      "explain cache write",
    );
  }

  return new Response(body, { headers: { ...headers, "X-Cache": "miss" } });
}
