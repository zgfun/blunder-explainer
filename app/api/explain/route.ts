import { after } from "next/server";
import { z } from "zod";
import { countExplanationsToday, findExplanation, formatExplanation, saveExplanation } from "../../../lib/llm/cache";
import { getClient } from "../../../lib/llm/client";
import { DeriveError, deriveBlunder, MAX_PV_UCI } from "../../../lib/llm/derive";
import { ExplainError, explainStream, type ExplainResult } from "../../../lib/llm/explain";
import { validateExplanation } from "../../../lib/llm/grounding";
import { explanationKey, promptId } from "../../../lib/llm/key";
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

  const client = getClient();
  if (!client) {
    return json(503, {
      error: "explanations-unavailable",
      message: "AI explanations are not available right now. The engine analysis is still accurate.",
    });
  }

  const cap = dailyCap();
  const today = await optional(() => countExplanationsToday(), CACHE_READ_MS, "explain daily count");
  if (today !== undefined && today >= cap) {
    const retryAfter = secondsToUtcMidnight();
    return json(429, { error: "rate-limited", reason: "daily", retryAfter }, { "Retry-After": String(retryAfter) });
  }
  const limit = getRateLimiter().consume(clientIp(request.headers));
  if (!limit.ok) {
    return json(
      429,
      { error: "rate-limited", reason: limit.reason, retryAfter: limit.retryAfter },
      { "Retry-After": String(limit.retryAfter) },
    );
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
    console.error("[explain] upstream error:", err);
    return json(502, { error: "upstream", message: "The explanation service failed. Please try again." });
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
        console.error("[explain] stream interrupted:", err);
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
      console.warn("[explain] incomplete:", err instanceof Error ? err.message : err);
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
        }),
      CACHE_WRITE_MS,
      "explain cache write",
    );
  }

  return new Response(body, { headers: { ...headers, "X-Cache": "miss" } });
}
