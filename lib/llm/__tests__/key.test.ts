import { describe, expect, it } from "vitest";
import { PROMPTS } from "../../../prompts";
import { explanationKey, promptId } from "../key";
import { SCHOLAR_BLUNDER } from "./fixtures";

describe("promptId", () => {
  it("changes when the prompt text or template changes, even under the same version", () => {
    const v2 = PROMPTS.v2;
    expect(promptId(v2)).toMatch(/^v2-[0-9a-f]{8}$/);
    expect(promptId(v2)).toBe(promptId(v2));
    expect(promptId({ ...v2, system: v2.system + " " })).not.toBe(promptId(v2));
    expect(promptId({ ...v2, buildUser: (b, l) => v2.buildUser(b, l) + "\nExtra: 1" })).not.toBe(promptId(v2));
    expect(promptId(PROMPTS.v1)).not.toBe(promptId(v2));
  });
});

describe("explanationKey", () => {
  it("differs whenever an input the prompt shows differs", () => {
    const base = explanationKey(SCHOLAR_BLUNDER, 1600);
    expect(base).toMatchObject({ fen: SCHOLAR_BLUNDER.fenBefore, playedUci: "g8f6", level: 1600 });
    const variants = [
      { ...SCHOLAR_BLUNDER, bestSan: "Qe7", pvSan: ["Qe7"] },
      { ...SCHOLAR_BLUNDER, refutationSan: ["Qxf7#"] },
      { ...SCHOLAR_BLUNDER, evalBeforePawns: 2 },
    ];
    for (const v of variants) expect(explanationKey(v, 1600).promptVersion).not.toBe(base.promptVersion);
    // Engine noise below the prompt's 0.1-pawn rounding shares the row.
    expect(explanationKey({ ...SCHOLAR_BLUNDER, evalBeforePawns: -0.31 }, 1600).promptVersion).toBe(base.promptVersion);
  });
});
