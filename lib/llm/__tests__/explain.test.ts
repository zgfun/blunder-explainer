import { describe, expect, it } from "vitest";
import { PROMPTS, THEMES } from "../../../prompts";
import { buildExplainRequest, ExplainError, explainStream, explainText, parseExplanation } from "../explain";
import { fakeClient, fakeStream, GOOD_ANSWER, SCHOLAR_BLUNDER } from "./fixtures";

async function collect(it: AsyncIterable<string>): Promise<string> {
  let out = "";
  for await (const chunk of it) out += chunk;
  return out;
}

describe("buildExplainRequest", () => {
  it("uses the explain model, low effort, default fallbacks and a cached system prefix", () => {
    const req = buildExplainRequest(SCHOLAR_BLUNDER, 1600);
    expect(req.model).toBe("claude-sonnet-5-5");
    expect(req.output_config).toEqual({ effort: "low" });
    expect(req.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(req.fallbacks).toBe("default");
    expect(req).not.toHaveProperty("thinking");
    expect(req.system).toEqual([{ type: "text", text: PROMPTS.v2.system, cache_control: { type: "ephemeral" } }]);
    expect(req.messages).toHaveLength(1);
    expect(req.messages[0].role).toBe("user");
  });

  it("keeps the system prompt identical across positions and levels", () => {
    const a = buildExplainRequest(SCHOLAR_BLUNDER, 1000);
    const b = buildExplainRequest({ ...SCHOLAR_BLUNDER, san: "Qe7" }, 2200);
    expect(a.system).toEqual(b.system);
  });
});

describe("prompts", () => {
  it("v2 grounds the user turn in engine data from the mover's perspective", () => {
    const user = PROMPTS.v2.buildUser(SCHOLAR_BLUNDER, 1600);
    expect(user).toContain("Level: 1600");
    expect(user).toContain(`Position before the move (FEN): ${SCHOLAR_BLUNDER.fenBefore}`);
    expect(user).toContain("Side to move: Black");
    expect(user).toContain("Move played: 3...Nf6");
    expect(user).toContain("Engine best move: g6");
    expect(user).toContain("Engine line: g6 Qd1 Bg7 d3 Na5");
    expect(user).toContain("Evaluation before (Black's view): +0.3 pawns");
    expect(user).toContain("Evaluation after (Black's view): forced mate for White");
    expect(user).toContain("Material before the move: Material is equal");
  });

  it("v2 system prompt lists every theme and is long enough to cache (>512 tokens)", () => {
    for (const t of THEMES) expect(PROMPTS.v2.system).toContain(t);
    expect(PROMPTS.v2.system.length / 4).toBeGreaterThan(600);
  });

  it("v1 is a simpler baseline with the same output header", () => {
    expect(PROMPTS.v1.version).toBe("v1");
    expect(PROMPTS.v1.system).toContain('{"theme":"fork"}');
    expect(PROMPTS.v1.buildUser(SCHOLAR_BLUNDER, 1000)).toContain("rated about 1000");
  });
});

describe("explainStream", () => {
  it("yields text deltas and resolves usage once consumed", async () => {
    const { client, stream } = fakeClient(() => fakeStream(['{"theme":"mate', ' threat"}\n', "Your knight..."]));
    const controller = new AbortController();
    const s = explainStream(SCHOLAR_BLUNDER, 1000, { client, signal: controller.signal });
    expect(await collect(s)).toBe('{"theme":"mate threat"}\nYour knight...');
    const result = await s.result;
    expect(result).toMatchObject({ stopReason: "end_turn", truncated: false, inputTokens: 40, outputTokens: 60, cacheReadTokens: 900 });
    expect(stream.mock.calls[0][1]).toEqual({ signal: controller.signal });
  });

  it("throws a refusal error when the whole fallback chain declines", async () => {
    const { client } = fakeClient(() => fakeStream([], { stop_reason: "refusal", content: [] }));
    const s = explainStream(SCHOLAR_BLUNDER, 1600, { client });
    await expect(collect(s)).rejects.toMatchObject({ code: "refusal" });
    await expect(s.result).rejects.toBeInstanceOf(ExplainError);
  });

  it("flags max_tokens as truncated", async () => {
    const { client } = fakeClient(() => fakeStream(["partial"], { stop_reason: "max_tokens" }));
    const result = await explainText(SCHOLAR_BLUNDER, 1600, { client });
    expect(result.truncated).toBe(true);
  });

  it("keeps only the text written after a server-side fallback switch", async () => {
    const content = [
      { type: "text", text: "declined partial", citations: null },
      { type: "fallback", from: { model: "claude-sonnet-5-5" }, to: { model: "claude-opus-4-8" } },
      { type: "text", text: GOOD_ANSWER, citations: null },
    ];
    const { client } = fakeClient(() => fakeStream(["declined partial", GOOD_ANSWER], { content, model: "claude-opus-4-8" }));
    const result = await explainText(SCHOLAR_BLUNDER, 1600, { client });
    expect(result.text).toBe(GOOD_ANSWER);
    expect(result.model).toBe("claude-opus-4-8");
  });

  it("aborts the upstream request when the consumer stops early", async () => {
    const fake = fakeStream(["a", "b", "c"]);
    const { client } = fakeClient(() => fake);
    const s = explainStream(SCHOLAR_BLUNDER, 1600, { client });
    for await (const chunk of s) {
      void chunk;
      break;
    }
    expect(fake.abort).toHaveBeenCalled();
    await expect(s.result).rejects.toMatchObject({ code: "aborted" });
  });

  it("throws no-client without a key", () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      expect(() => explainStream(SCHOLAR_BLUNDER, 1600)).toThrow(ExplainError);
    } finally {
      if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
    }
  });
});

describe("parseExplanation", () => {
  it.each([
    ["clean", GOOD_ANSWER, "mate threat"],
    ["code fences", '```json\n{"theme": "fork"}\n```\nThe knight hits both.', "fork"],
    ["preamble", 'Here you go:\n{"theme":"pin"}\nThe bishop pins it.', "pin"],
    ["same line", '{"theme":"skewer"} The rook is skewered.', "skewer"],
    ["case and spaces", '{ "theme" : "Back Rank" }\nYour king is stuck.', "back rank"],
  ])("handles %s", (_, input, theme) => {
    const out = parseExplanation(input);
    expect(out.theme).toBe(theme);
    expect(out.text).not.toContain("{");
    expect(out.text).not.toContain("```");
    expect(out.text.length).toBeGreaterThan(5);
  });

  it("returns a null theme for unknown themes but still strips the header", () => {
    expect(parseExplanation('{"theme":"zwischenzug"}\nText.')).toEqual({ theme: null, text: "Text." });
  });

  it("returns the whole text when no header exists", () => {
    expect(parseExplanation("  Just prose.  ")).toEqual({ theme: null, text: "Just prose." });
  });

  it("keeps prose before a header that appears late", () => {
    const out = parseExplanation('Line one.\nLine two.\nLine three.\n{"theme":"fork"}\nLine four.');
    expect(out.theme).toBe("fork");
    expect(out.text).toContain("Line one.");
    expect(out.text).toContain("Line four.");
  });

  it("survives a malformed JSON header", () => {
    const out = parseExplanation('{"theme":"fork", oops}\nThe knight forks.');
    expect(out.theme).toBe("fork");
    expect(out.text).toBe("The knight forks.");
  });
});
