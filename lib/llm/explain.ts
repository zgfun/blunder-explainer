import type Anthropic from "@anthropic-ai/sdk";
import type { BetaMessageStreamParams } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { Blunder } from "../chess/types";
import { CURRENT_PROMPT, toTheme, type Level, type PromptDef, type Theme } from "../../prompts";
import { EXPLAIN_MODEL, getClient } from "./client";

type StreamParams = BetaMessageStreamParams;
type BetaMessage = Anthropic.Beta.Messages.BetaMessage;

export type ExplainErrorCode = "no-client" | "refusal" | "aborted";

export class ExplainError extends Error {
  constructor(
    public code: ExplainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ExplainError";
  }
}

export type ExplainResult = {
  /** Full raw text (JSON header line + prose) as the final model that answered wrote it. */
  text: string;
  model: string;
  stopReason: string | null;
  /** True when the answer hit max_tokens and is cut off; callers should not cache it. */
  truncated: boolean;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

export type ExplainStream = AsyncIterable<string> & { result: Promise<ExplainResult> };

export type ExplainOptions = {
  prompt?: PromptDef;
  client?: Anthropic;
  signal?: AbortSignal;
  model?: string;
};

// Thinking counts toward max_tokens; at effort "low" it is usually skipped, but leave headroom.
const MAX_TOKENS = 2048;

export function buildExplainRequest(
  b: Blunder,
  level: Level,
  prompt: PromptDef = CURRENT_PROMPT,
  model: string = EXPLAIN_MODEL,
): StreamParams {
  return {
    model,
    max_tokens: MAX_TOKENS,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low" },
    system: [{ type: "text", text: prompt.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: prompt.buildUser(b, level) }],
  };
}

/**
 * All text blocks in order. On a mid-stream server-side fallback the API keeps the declined
 * partial and the fallback model continues from it, so partial + continuation is the answer
 * (and exactly what the client was streamed); the `fallback` block is only a marker.
 */
export function finalText(message: BetaMessage): string {
  return message.content.map((block) => (block.type === "text" ? block.text : "")).join("");
}

function summarize(message: BetaMessage): ExplainResult {
  const u = message.usage;
  return {
    text: finalText(message),
    model: message.model,
    stopReason: message.stop_reason,
    truncated: message.stop_reason === "max_tokens",
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
  };
}

/**
 * Streams text deltas of an explanation. `result` settles after the stream is fully consumed;
 * it rejects with ExplainError("refusal") if the whole fallback chain declined.
 */
export function explainStream(b: Blunder, level: Level, opts: ExplainOptions = {}): ExplainStream {
  const client = opts.client ?? getClient();
  if (!client) throw new ExplainError("no-client", "ANTHROPIC_API_KEY is not configured");
  const params = buildExplainRequest(b, level, opts.prompt, opts.model);

  let settle!: { resolve: (r: ExplainResult) => void; reject: (e: unknown) => void };
  const result = new Promise<ExplainResult>((resolve, reject) => {
    settle = { resolve, reject };
  });
  // Consumers that only iterate shouldn't trigger unhandled-rejection warnings.
  result.catch(() => {});

  async function* run(): AsyncGenerator<string> {
    const stream = client!.beta.messages.stream(params, { signal: opts.signal });
    let finished = false;
    try {
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield event.delta.text;
        }
      }
      const message = await stream.finalMessage();
      finished = true;
      if (message.stop_reason === "refusal") {
        throw new ExplainError("refusal", "The model declined to explain this position");
      }
      settle.resolve(summarize(message));
    } catch (err) {
      finished = true;
      settle.reject(err);
      throw err;
    } finally {
      if (!finished) {
        stream.abort();
        settle.reject(new ExplainError("aborted", "Explanation stream was cancelled"));
      }
    }
  }

  const iterator = run();
  return { [Symbol.asyncIterator]: () => iterator, result };
}

/** Collects a whole explanation (used by the eval and precompute scripts). */
export async function explainText(
  b: Blunder,
  level: Level,
  opts: ExplainOptions = {},
): Promise<ExplainResult> {
  const stream = explainStream(b, level, opts);
  for await (const chunk of stream) void chunk;
  return stream.result;
}

const FENCE_RE = /^\s*```[a-z]*\s*$/i;
const THEME_JSON_RE = /\{[^{}]*"theme"\s*:\s*"[^"]*"[^{}]*\}/;

/**
 * Splits the model output into the theme header and prose. Tolerates preambles, code fences,
 * a missing header and a header on the same line as the prose.
 */
export function parseExplanation(fullText: string): { theme: Theme | null; text: string } {
  const lines = fullText.replace(/\r\n/g, "\n").split("\n").filter((l) => !FENCE_RE.test(l));
  const joined = lines.join("\n");
  const match = THEME_JSON_RE.exec(joined);
  if (!match) return { theme: null, text: joined.trim() };

  let theme: Theme | null = null;
  try {
    theme = toTheme((JSON.parse(match[0]) as { theme?: unknown }).theme);
  } catch {
    theme = toTheme(/"theme"\s*:\s*"([^"]*)"/.exec(match[0])?.[1]);
  }

  const before = joined.slice(0, match.index);
  const after = joined.slice(match.index + match[0].length);
  // A header near the top means anything before it is preamble; otherwise keep the prose around it.
  const nonEmptyBefore = before.split("\n").filter((l) => l.trim()).length;
  const text = nonEmptyBefore <= 2 ? after : `${before}\n${after}`;
  return { theme, text: text.replace(/\n{3,}/g, "\n\n").trim() };
}
