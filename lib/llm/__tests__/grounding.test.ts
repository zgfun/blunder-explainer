import { describe, expect, it } from "vitest";
import { sanTokens, validateExplanation } from "../grounding";
import { GOOD_ANSWER, SCHOLAR_BLUNDER } from "./fixtures";

describe("sanTokens", () => {
  it("finds move notation but ignores bare squares and words", () => {
    const text = "After 3...Nf6 the pawn on f7 falls to Qxf7#; Bxe6, exd5, O-O, 0-0-0, e8=Q and Rae1+ are moves. Be careful.";
    expect(sanTokens(text)).toEqual(["Nf6", "Qxf7#", "Bxe6", "exd5", "O-O", "0-0-0", "e8=Q", "Rae1+"]);
  });
});

describe("validateExplanation", () => {
  it("accepts prose that only names the played move and engine-line moves", () => {
    expect(validateExplanation(GOOD_ANSWER, SCHOLAR_BLUNDER)).toEqual({ ok: true, problems: [] });
  });

  it("flags invented moves, ignoring check marks", () => {
    const res = validateExplanation('{"theme":"fork"}\nInstead of Nf6 play Qe7+ or Bg7, then Nd4.', SCHOLAR_BLUNDER);
    expect(res.ok).toBe(false);
    expect(res.problems[0]).toContain("Qe7+");
    expect(res.problems[0]).toContain("Nd4");
    expect(res.problems[0]).not.toContain("Bg7");
  });

  it("flags the refutation when it is not in the engine line", () => {
    const res = validateExplanation("Nf6 allows Qxf7#.", SCHOLAR_BLUNDER);
    expect(res.problems.join()).toContain("Qxf7#");
  });

  it("flags explanations over 100 words", () => {
    const long = `{"theme":"positional"}\n${"word ".repeat(101)}`;
    const res = validateExplanation(long, SCHOLAR_BLUNDER);
    expect(res.ok).toBe(false);
    expect(res.problems.join()).toContain("101 words");
  });

  it("flags empty explanations", () => {
    expect(validateExplanation('{"theme":"fork"}\n', SCHOLAR_BLUNDER).ok).toBe(false);
  });
});
