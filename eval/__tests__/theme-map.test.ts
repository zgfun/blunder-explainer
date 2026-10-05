import { describe, expect, it } from "vitest";
import { THEMES } from "@/prompts";
import { acceptableThemes, LICHESS_THEME_RULES, mapLichessThemes } from "../theme-map";

describe("mapLichessThemes", () => {
  it.each([
    [["middlegame", "fork", "short"], "fork"],
    [["endgame", "mateIn2", "backRankMate"], "back rank"],
    [["fork", "kingsideAttack", "mateIn3"], "fork"],
    [["pin", "crushing"], "pin"],
    [["skewer"], "skewer"],
    [["hangingPiece", "advantage", "oneMove"], "hanging piece"],
    [["discoveredAttack", "pin"], "pin"],
    [["trappedPiece"], "trapped piece"],
    [["deflection", "mateIn3"], "overloaded defender"],
    [["capturingDefender"], "overloaded defender"],
    [["mateIn1", "oneMove"], "mate threat"],
    [["exposedKing", "long"], "king safety"],
    [["advancedPawn", "promotion", "endgame"], "pawn structure"],
    [["rookEndgame", "crushing"], "endgame technique"],
    [["opening", "advantage"], "tempo / development"],
    [["crushing", "long"], "positional"],
  ])("%j -> %s", (themes, expected) => {
    expect(mapLichessThemes(themes)).toBe(expected);
  });

  it("only maps to themes the prompts know", () => {
    for (const [, ours] of LICHESS_THEME_RULES) expect(THEMES).toContain(ours);
  });
});

describe("acceptableThemes", () => {
  it("lists every supported theme, primary first, without duplicates", () => {
    expect(acceptableThemes(["mateIn2", "backRankMate", "deflection"])).toEqual([
      "back rank",
      "overloaded defender",
      "mate threat",
      "king safety",
    ]);
  });

  it("falls back to positional", () => {
    expect(acceptableThemes(["long"])).toEqual(["positional"]);
  });
});
