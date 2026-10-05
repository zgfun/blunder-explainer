import { z } from "zod";
import { CURRENT_PROMPT } from "../../../prompts";
import { findExplanation, formatExplanation, saveExplanation, type ExplanationKey } from "../../../lib/llm/cache";
import { getClient } from "../../../lib/llm/client";
import { DeriveError, deriveBlunder, MAX_PV_UCI } from "../../../lib/llm/derive";
import { ExplainError, explainStream, type ExplainResult } from "../../../lib/llm/explain";
import { validateExplanation } from "../../../lib/llm/grounding";
import { clientIp, getRateLimiter } from "../../../lib/rate-limit";
import type { Blunder } from "../../../lib/chess/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const Uci = z.string().regex(/^[a-h][1-8][a-h][1-8][qrbn]?$/, "must be a UCI move like e2e4");
const Cp = z.number().min(-100000).max(100000);

// Only a FEN, UCI moves and numbers are accepted: no client-provided text can reach the prompt.
const Body = z.object({
  fenBefore: z.string().min(15).max(100),
  playedUci: Uci,
  level: z.union([z.literal(1000), z.literal(1600), z.literal(2200)]),
  bestUci: Uci,
  pvUci: z.array(Uci).max(MAX_PV_UCI).default([]),
  evalBeforeCp: Cp,
  evalAfterCp: Cp,
});

const TEXT_HEADERS = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" };

function json(status: number, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
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

  const key: ExplanationKey = {
    fen: blunder.fenBefore,
    playedUci: blunder.uci,
    level,
    promptVersion: CURRENT_PROMPT.version,
  };
  const headers = { ...TEXT_HEADERS, "X-Prompt-Version": CURRENT_PROMPT.version };

  try {
    const hit = await findExplanation(key);
    if (hit) {
      return new Response(formatExplanation(hit.theme, hit.text), { headers: { ...headers, "X-Cache": "hit" } });
    }
  } catch (err) {
    console.warn("[explain] cache lookup skipped:", err instanceof Error ? err.message : err);
  }

  const client = getClient();
  if (!client) {
    return json(503, {
      error: "explanations-unavailable",
      message: "AI explanations are not available right now. The engine analysis is still accurate.",
    });
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

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      if (first.done) {
        void finish(controller);
      } else {
        controller.enqueue(encoder.encode(first.value));
      }
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
        controller.enqueue(encoder.encode("\n\n(The explanation was interrupted. Please try again.)"));
        controller.close();
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });

  async function finish(controller: ReadableStreamDefaultController<Uint8Array>) {
    try {
      await persist(await stream.result);
    } catch (err) {
      console.warn("[explain] not cached:", err instanceof Error ? err.message : err);
    }
    controller.close();
  }

  async function persist(result: ExplainResult) {
    const check = validateExplanation(result.text, blunder);
    if (!check.ok) console.warn("[explain] grounding problems:", check.problems.join("; "));
    if (result.truncated) throw new Error("explanation hit max_tokens");
    await saveExplanation(key, {
      rawText: result.text,
      model: result.model,
      inputTokens: result.inputTokens + result.cacheReadTokens + result.cacheWriteTokens,
      outputTokens: result.outputTokens,
    });
  }

  return new Response(body, { headers: { ...headers, "X-Cache": "miss" } });
}
