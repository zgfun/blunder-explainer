import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { PROMPTS } from "@/prompts";
import { parseArgs } from "@/scripts/eval";
import positions from "../positions.json";
import { buildGraderPrompt } from "../grader";
import { formatTable, runEval, type ExplanationCache } from "../run";
import type { TestPosition } from "../types";

const set = (positions as TestPosition[]).slice(0, 6);

function fakeStream(text: string) {
  return {
    abort: vi.fn(),
    async *[Symbol.asyncIterator]() {
      yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } };
    },
    finalMessage: async () => ({
      model: "claude-sonnet-5-5",
      content: [{ type: "text", text, citations: null }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    }),
  };
}

/** Explains with the played and best move (grounded) except for one position, where it invents a move. */
function fakeClient() {
  const stream = vi.fn((params: { messages: { content: string }[] }) => {
    const target = set.find((p) => params.messages[0].content.includes(p.blunder.fenBefore))!;
    const b = target.blunder;
    const invented = target === set[1] ? " Also consider Qh7, which wins." : "";
    return fakeStream(`{"theme":"${target.expectedTheme}"}\n${b.san} lets the opponent strike. ${b.bestSan} was better.${invented}`);
  });
  const parse = vi.fn(async (params: { messages: { content: string }[]; output_config: unknown; model: string }) => {
    const wrong = params.messages[0].content.includes(set[2].blunder.fenBefore);
    return {
      stop_reason: "end_turn",
      parsed_output: {
        correct: !wrong,
        mentionsRightIdea: !wrong,
        contradictsEngine: wrong,
        inventsMoves: false,
        reason: wrong ? "wrong piece" : "names the tactic",
      },
    };
  });
  return { client: { beta: { messages: { stream } }, messages: { parse } } as unknown as Anthropic, stream, parse };
}

function memoryCache(): ExplanationCache & { rows: Map<string, { theme: null; text: string; model: string }> } {
  const rows = new Map<string, { theme: null; text: string; model: string }>();
  const k = (key: { fen: string; playedUci: string; level: number; promptVersion: string }) =>
    [key.fen, key.playedUci, key.level, key.promptVersion].join("|");
  return {
    rows,
    find: async (key) => rows.get(k(key)) ?? null,
    save: async (key, v) => {
      rows.set(k(key), { theme: null, text: v.rawText.split("\n").slice(1).join("\n"), model: v.model });
    },
  };
}

describe("runEval (dry run, mocked client)", () => {
  it("combines grader verdicts with deterministic grounding", async () => {
    const { client, stream, parse } = fakeClient();
    const summary = await runEval({ positions: set, prompt: PROMPTS.v2, level: 1600, client, concurrency: 4 });
    expect(stream).toHaveBeenCalledTimes(6);
    expect(parse).toHaveBeenCalledTimes(6);
    expect(summary.positions).toBe(6);
    expect(summary.results.map((r) => r.puzzleId)).toEqual(set.map((p) => p.puzzleId));
    // set[1] invents a move (grounding fails), set[2] is graded wrong.
    expect(summary.results[1].grounding.ok).toBe(false);
    expect(summary.results[1].correct).toBe(false);
    expect(summary.results[2].correct).toBe(false);
    expect(summary.correct).toBe(4);
    expect(summary.score).toBeCloseTo(4 / 6);
    expect(summary.themeMatches).toBe(6);
    expect(formatTable(summary)).toContain("4/6 rated correct (66.7%)");

    const graderCall = parse.mock.calls[0][0];
    expect(graderCall.model).toBe("claude-opus-5-5");
    expect(graderCall.output_config).toMatchObject({ effort: "high", format: { type: "json_schema" } });
  });

  it("reuses cached explanations on a re-run and only pays for grading", async () => {
    const cache = memoryCache();
    const first = fakeClient();
    await runEval({ positions: set, prompt: PROMPTS.v2, level: 1600, client: first.client, cache });
    expect(cache.rows.size).toBe(6);
    const second = fakeClient();
    const summary = await runEval({ positions: set, prompt: PROMPTS.v2, level: 1600, client: second.client, cache });
    expect(second.stream).not.toHaveBeenCalled();
    expect(second.parse).toHaveBeenCalledTimes(6);
    expect(summary.results.every((r) => r.cached)).toBe(true);
  });

  it("records failures per position instead of aborting the run", async () => {
    const { client, parse } = fakeClient();
    parse.mockRejectedValueOnce(new Error("overloaded"));
    const summary = await runEval({ positions: set.slice(0, 2), prompt: PROMPTS.v1, level: 1000, client, concurrency: 1 });
    expect(summary.results[0]).toMatchObject({ correct: false, error: "overloaded" });
    expect(summary.positions).toBe(2);
  });
});

describe("grader prompt", () => {
  it("includes the ground truth and the puzzle refutation in SAN", () => {
    const p = set[0];
    const prompt = buildGraderPrompt(p, "Some explanation.");
    expect(prompt).toContain(p.blunder.fenBefore);
    expect(prompt).toContain(`Move played (the mistake): ${p.blunder.san}`);
    expect(prompt).toContain(p.blunder.pvSan.join(" "));
    expect(prompt).not.toMatch(/winning sequence after the mistake \(puzzle solution\): [a-h][1-8][a-h][1-8]/);
    expect(prompt).toContain("<explanation>\nSome explanation.\n</explanation>");
  });
});

describe("parseArgs", () => {
  const now = new Date("2026-10-05T10:00:00.000Z");
  it("defaults to the current prompt at level 1600", () => {
    expect(parseArgs([], now)).toEqual({ prompt: "v2", level: 1600, limit: null, timestamp: "2026-10-05T10-00-00-000Z", concurrency: 4 });
  });
  it("accepts overrides and rejects bad values", () => {
    expect(parseArgs(["--prompt", "v1", "--level", "2200", "--limit", "5", "--timestamp", "run1"], now)).toMatchObject({
      prompt: "v1",
      level: 2200,
      limit: 5,
      timestamp: "run1",
    });
    expect(() => parseArgs(["--prompt", "v9"], now)).toThrow();
    expect(() => parseArgs(["--level", "1800"], now)).toThrow();
    expect(() => parseArgs(["--timestamp", "../x"], now)).toThrow();
  });
});
