import { describe, expect, it } from "vitest";
import { sanTokens, validateExplanation } from "../grounding";
import { GOOD_ANSWER, SCHOLAR_BLUNDER } from "./fixtures";

describe("sanTokens", () => {
  it("finds move notation but ignores bare squares and words", () => {
    const text = "After 3...Nf6 the pawn on f7 falls to Qxf7#; Bxe6, exd5, O-O, 0-0-0, e8=Q and Rae1+ are moves. Be careful.";
    expect(sanTokens(text)).toEqual(["Nf6", "Qxf7#", "Bxe6", "exd5", "O-O", "0-0-0", "e8=Q", "Rae1+"]);
  });

  it("counts bare pawn pushes only in a move context", () => {
    expect(sanTokens("You should play d4 to gain space.")).toEqual(["d4"]);
    expect(sanTokens("After e5 the knight is lost")).toEqual(["e5"]);
    expect(sanTokens("17. h4 and 17...g5+ then …a5")).toEqual(["h4", "g5+", "a5"]);
    expect(sanTokens("The pawn on d4 guards e5, and the d5 square is weak.")).toEqual([]);
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

  it("flags an invented pawn move but accepts the engine's own", () => {
    const res = validateExplanation('{"theme":"fork"}\nNf6 was bad; you should play d5. The better plan was g6.', SCHOLAR_BLUNDER);
    expect(res.problems).toEqual(["mentions moves not in the engine line: d5"]);
  });

  it("ignores disambiguation when matching moves", () => {
    const b = { ...SCHOLAR_BLUNDER, pvSan: ["g6", "Qd1", "Nge7"] };
    expect(validateExplanation("Play g6, then Ne7 or N8e7 follows.", b).ok).toBe(true);
  });

  it("allows moves from the engine reply line", () => {
    const b = { ...SCHOLAR_BLUNDER, refutationSan: ["Qxf7#"] };
    expect(validateExplanation("Nf6 allows Qxf7#.", b)).toEqual({ ok: true, problems: [] });
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
