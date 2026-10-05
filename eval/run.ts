import type Anthropic from "@anthropic-ai/sdk";
import type { ExplanationKey, CachedExplanation } from "@/lib/llm/cache";
import { EXPLAIN_MODEL, GRADER_MODEL } from "@/lib/llm/client";
import { explainText, parseExplanation } from "@/lib/llm/explain";
import { validateExplanation } from "@/lib/llm/grounding";
import { explanationKey, promptId } from "@/lib/llm/key";
import type { Level, PromptDef, Theme } from "@/prompts";
import { gradeExplanation, type Grade } from "./grader";
import type { TestPosition } from "./types";

export type ExplanationCache = {
  find(key: ExplanationKey): Promise<CachedExplanation | null>;
  save(
    key: ExplanationKey,
    value: { rawText: string; model: string; inputTokens?: number; outputTokens?: number },
  ): Promise<void>;
};

export type PositionResult = {
  id: string;
  puzzleId: string;
  rating: number;
  move: string;
  expectedTheme: Theme;
  theme: Theme | null;
  themeMatches: boolean;
  explanation: string;
  cached: boolean;
  grounding: { ok: boolean; problems: string[] };
  grade: Grade | null;
  correct: boolean;
  error?: string;
};

export type EvalSummary = {
  promptVersion: string;
  level: Level;
  model: string;
  graderModel: string;
  positions: number;
  correct: number;
  score: number;
  groundingOk: number;
  themeMatches: number;
  results: PositionResult[];
};

export type RunEvalOptions = {
  positions: TestPosition[];
  prompt: PromptDef;
  level: Level;
  client: Anthropic;
  cache?: ExplanationCache | null;
  concurrency?: number;
  onResult?: (r: PositionResult, done: number, total: number) => void;
};

async function evaluateOne(p: TestPosition, opts: RunEvalOptions): Promise<PositionResult> {
  const b = p.blunder;
  const key: ExplanationKey = explanationKey(b, opts.level, opts.prompt);
  const move = `${b.moveNumber}${b.side === "white" ? "." : "..."}${b.san}`;
  const base = { id: p.id, puzzleId: p.puzzleId, rating: p.rating, move, expectedTheme: p.expectedTheme };
  try {
    let theme: Theme | null;
    let text: string;
    let cached = false;
    const hit = opts.cache ? await opts.cache.find(key).catch(() => null) : null;
    if (hit) {
      ({ theme, text } = hit);
      cached = true;
    } else {
      const result = await explainText(b, opts.level, { client: opts.client, prompt: opts.prompt });
      ({ theme, text } = parseExplanation(result.text));
      if (!result.truncated && opts.cache) {
        await opts.cache
          .save(key, {
            rawText: result.text,
            model: result.model,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
          })
          .catch(() => undefined);
      }
    }
    const grounding = validateExplanation(text, b);
    const { grade, error } = await gradeExplanation(opts.client, p, text);
    return {
      ...base,
      theme,
      themeMatches: theme !== null && p.acceptableThemes.includes(theme),
      explanation: text,
      cached,
      grounding,
      grade,
      correct: Boolean(grade?.correct) && grounding.ok,
      ...(error ? { error } : {}),
    };
  } catch (err) {
    return {
      ...base,
      theme: null,
      themeMatches: false,
      explanation: "",
      cached: false,
      grounding: { ok: false, problems: [] },
      grade: null,
      correct: false,
      error: (err as Error).message,
    };
  }
}

/** "Correct" = the grader says correct AND the deterministic grounding checks pass. */
export async function runEval(opts: RunEvalOptions): Promise<EvalSummary> {
  const total = opts.positions.length;
  const results: PositionResult[] = new Array(total);
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < total) {
      const i = next++;
      results[i] = await evaluateOne(opts.positions[i], opts);
      opts.onResult?.(results[i], ++done, total);
    }
  }
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 4, total) }, worker));
  const correct = results.filter((r) => r.correct).length;
  return {
    promptVersion: promptId(opts.prompt),
    level: opts.level,
    model: EXPLAIN_MODEL,
    graderModel: GRADER_MODEL,
    positions: total,
    correct,
    score: total ? correct / total : 0,
    groundingOk: results.filter((r) => r.grounding.ok).length,
    themeMatches: results.filter((r) => r.themeMatches).length,
    results,
  };
}

export function formatTable(summary: EvalSummary): string {
  const rows = summary.results.map((r) => {
    const verdict = r.correct ? "PASS" : "fail";
    const why = r.error ?? (r.grounding.ok ? (r.grade?.reason ?? "") : r.grounding.problems.join("; "));
    return [
      verdict,
      r.puzzleId.padEnd(6),
      String(r.rating).padStart(4),
      r.move.padEnd(10),
      (r.theme ?? "-").padEnd(20),
      why.length > 70 ? why.slice(0, 67) + "..." : why,
    ].join("  ");
  });
  const pct = Math.round(summary.score * 1000) / 10;
  return [
    ...rows,
    "",
    `Prompt ${summary.promptVersion} @ level ${summary.level}: ${summary.correct}/${summary.positions} rated correct (${pct}%)`,
    `Grounding checks passed: ${summary.groundingOk}/${summary.positions}; theme matched the puzzle: ${summary.themeMatches}/${summary.positions}`,
  ].join("\n");
}
