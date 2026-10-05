import { describe, expect, it } from "vitest";
import {
  cpLossForMove,
  evalSeriesPawns,
  pickBlunders,
  scoreToWhiteCp,
  toPawnsClamped,
  winChance,
  winChanceLossForMove,
} from "@/lib/chess/analysis";
import { parsePgn } from "@/lib/chess/pgn";
import type { EngineLine, Score } from "@/lib/chess/types";

const line = (score: Score, bestUci: string, pvUci: string[] = [bestUci]): EngineLine => ({
  depth: 16,
  score,
  bestUci,
  pvUci,
});

describe("scoreToWhiteCp", () => {
  it("flips sign for black to move", () => {
    expect(scoreToWhiteCp({ cp: 120 }, "white")).toBe(120);
    expect(scoreToWhiteCp({ cp: 120 }, "black")).toBe(-120);
    expect(scoreToWhiteCp({ cp: -45 }, "black")).toBe(45);
  });

  it("maps mates to large values that shrink with distance", () => {
    expect(scoreToWhiteCp({ mate: 3 }, "white")).toBe(99700);
    expect(scoreToWhiteCp({ mate: 3 }, "black")).toBe(-99700);
    expect(scoreToWhiteCp({ mate: -2 }, "white")).toBe(-99800);
    expect(scoreToWhiteCp({ mate: -2 }, "black")).toBe(99800);
    expect(scoreToWhiteCp({ mate: 0 }, "white")).toBe(-100000);
    expect(scoreToWhiteCp({ mate: 0 }, "black")).toBe(100000);
    expect(scoreToWhiteCp({ mate: 1 }, "white")).toBeGreaterThan(scoreToWhiteCp({ mate: 5 }, "white"));
  });
});

describe("toPawnsClamped", () => {
  it("converts to pawns and clamps mates to ±100", () => {
    expect(toPawnsClamped(250)).toBe(2.5);
    expect(toPawnsClamped(-37)).toBe(-0.37);
    expect(toPawnsClamped(99700)).toBe(100);
    expect(toPawnsClamped(-100000)).toBe(-100);
    expect(toPawnsClamped(25000)).toBe(100);
  });
});

describe("cpLossForMove", () => {
  it("computes loss from the mover's perspective for both colours", () => {
    // White +0.3 before; after the move Black (to move) is +2 → White -2.
    expect(cpLossForMove(line({ cp: 30 }, "e2e4"), line({ cp: 200 }, "e7e5"), "white")).toBe(230);
    // Black to move at -0.4 (Black's view); after, White to move at +9 → Black -9.
    expect(cpLossForMove(line({ cp: -40 }, "b8c6"), line({ cp: 900 }, "f3g5"), "black")).toBe(860);
  });

  it("never returns negative loss", () => {
    expect(cpLossForMove(line({ cp: 10 }, "e2e4"), line({ cp: -300 }, "a7a6"), "white")).toBe(0);
  });

  it("treats a slower but still forced mate as no loss (clamping)", () => {
    // Mate in 3 before; after the move opponent is getting mated in 5 (mate -5 from their view).
    expect(cpLossForMove(line({ mate: 3 }, "a1a8"), line({ mate: -5 }, "h7h6"), "white")).toBe(0);
  });

  it("scores a missed mate as a large but bounded loss", () => {
    expect(cpLossForMove(line({ mate: 2 }, "a1a8"), line({ cp: 50 }, "h7h6"), "white")).toBe(1550);
    expect(cpLossForMove(line({ mate: 2 }, "a1a8"), line({ mate: 1 }, "h7h6"), "white")).toBe(3000);
  });

  it("delivering mate is never a loss", () => {
    expect(cpLossForMove(line({ mate: 1 }, "h5f7"), line({ mate: 0 }, ""), "white")).toBe(0);
  });
});

// 1. e4 e5 2. Nf3 Qg5?? 3. Nxg5 — Black hangs the queen. 1. e4 is also flagged as a
// (stubbed) small white mistake so we can test side filtering and ordering.
const HUNG_QUEEN_PGN = `[White "w"]
[Black "b"]

1. e4 e5 2. Nf3 Qg5 3. Nxg5 *`;

const HUNG_QUEEN_LINES: EngineLine[] = [
  line({ cp: 30 }, "d2d4", ["d2d4", "d7d5", "c2c4"]), // before 1. e4 (white)
  line({ cp: 150 }, "e7e5", ["e7e5"]), // before 1... e5 (black)
  line({ cp: 30 }, "g1f3", ["g1f3"]), // before 2. Nf3 (white)
  line({ cp: -40 }, "b8c6", ["b8c6", "f1b5", "a7a6", "b5a4", "g8f6", "e1g1"]), // before 2... Qg5
  line({ cp: 900 }, "f3g5", ["f3g5"]), // before 3. Nxg5
  line({ cp: -880 }, "h7h6", ["h7h6"]), // final position (black to move)
];

describe("pickBlunders", () => {
  const game = parsePgn(HUNG_QUEEN_PGN);

  it("finds the hung queen with full details", () => {
    const [b] = pickBlunders(game, HUNG_QUEEN_LINES, { side: "black" });
    expect(b).toMatchObject({
      ply: 3,
      side: "black",
      sideToMove: "black",
      moveNumber: 2,
      san: "Qg5",
      uci: "d8g5",
      bestUci: "b8c6",
      bestSan: "Nc6",
      pvSan: ["Nc6", "Bb5", "a6", "Ba4", "Nf6"],
      pvUci: ["b8c6", "f1b5", "a7a6", "b5a4", "g8f6", "e1g1"],
      refutationSan: ["Nxg5"],
      refutationUci: ["f3g5"],
      evalBeforePawns: 0.4,
      evalAfterPawns: 9,
      cpLoss: 860,
      materialBalance: "Material is equal",
    });
    expect(b.fenBefore).toBe(game.plies[3].fenBefore);
    expect(b.fenAfter).toBe(game.plies[3].fenAfter);
  });

  it("filters by side and sorts by cp loss", () => {
    const both = pickBlunders(game, HUNG_QUEEN_LINES, { side: "both" });
    expect(both.map((b) => b.san)).toEqual(["Qg5", "e4"]);
    expect(both[1].cpLoss).toBe(180);
    expect(pickBlunders(game, HUNG_QUEEN_LINES, { side: "white" }).map((b) => b.san)).toEqual(["e4"]);
    expect(pickBlunders(game, HUNG_QUEEN_LINES, { side: "both", count: 1 })).toHaveLength(1);
    expect(pickBlunders(game, HUNG_QUEEN_LINES, { side: "both", minCpLoss: 500 })).toHaveLength(1);
  });

  it("skips moves equal to the engine's best move even if eval dropped", () => {
    const lines = HUNG_QUEEN_LINES.map((l) => ({ ...l }));
    lines[2] = line({ cp: 500 }, "g1f3"); // Nf3 is best, eval "drops" afterwards
    const out = pickBlunders(game, lines, { side: "white" });
    expect(out.find((b) => b.san === "Nf3")).toBeUndefined();
  });

  it("breaks ties by ply and ignores plies without analysis", () => {
    const lines = HUNG_QUEEN_LINES.slice(0, 3);
    lines[1] = line({ cp: 150 }, "e7e5");
    const out = pickBlunders(game, lines, { side: "both" });
    expect(out.map((b) => b.ply)).toEqual([0]);
  });

  it("produces a white-perspective eval series", () => {
    expect(evalSeriesPawns(game, HUNG_QUEEN_LINES)).toEqual([0.3, -1.5, 0.3, 0.4, 9, 8.8]);
  });
});

describe("winChance", () => {
  it("is symmetric, saturates on mates and is flat in decided positions", () => {
    expect(winChance(0)).toBe(0);
    expect(winChance(300)).toBeCloseTo(-winChance(-300));
    expect(winChance(99_700)).toBe(1);
    expect(winChance(-100_000)).toBe(-1);
    const decided = winChance(1342) - winChance(977);
    const swing = winChance(263) - winChance(27);
    expect(decided).toBeLessThan(0.05);
    expect(swing).toBeGreaterThan(0.35);
  });

  it("measures loss from the mover's perspective in [0, 1]", () => {
    // Black to move at +0.4 (Black's view); after, White to move at +9.
    expect(winChanceLossForMove(line({ cp: 40 }, "b8c6"), line({ cp: 900 }, "f3g5"))).toBeGreaterThan(0.45);
    expect(winChanceLossForMove(line({ mate: 2 }, "a1a8"), line({ mate: 1 }, "h7h6"))).toBe(1);
    expect(winChanceLossForMove(line({ cp: 10 }, "e2e4"), line({ cp: -300 }, "a7a6"))).toBe(0);
  });
});

describe("pickBlunders ranking", () => {
  // Same swings as the sample game's 19.Qb3 (+2.63 → +0.27) and 23...Kxg6 (13.42 → 9.77 for the mover).
  const game = parsePgn("1. e4 e5 2. Nf3 Nc6 *");
  it("ranks a thrown-away advantage above a bigger cp swing in a lost position", () => {
    const lines: EngineLine[] = [
      line({ cp: 263 }, "d2d4"), // before 1. e4: White +2.63
      line({ cp: -27 }, "c7c5"), // after: White +0.27 (Black to move)
      line({ cp: 1342 }, "b1c3"), // before 2. Nf3: White +13.42
      line({ cp: -977 }, "g8f6"), // after: White +9.77
      line({ cp: 977 }, "d2d4"),
    ];
    const out = pickBlunders(game, lines, { side: "white" });
    expect(out.map((b) => b.san)).toEqual(["e4"]);
    expect(out[0].cpLoss).toBe(236);
    // The decided-position move clears minCpLoss but not the win-chance threshold.
    expect(pickBlunders(game, lines, { side: "white", minWinChanceLoss: 0 }).map((b) => b.san)).toEqual(["e4", "Nf3"]);
  });
});

describe("terminal positions in a game", () => {
  it("the mating move is not a blunder; the move allowing mate is", () => {
    const game = parsePgn("1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0");
    const lines: EngineLine[] = [
      line({ cp: 30 }, "e2e4"),
      line({ cp: -30 }, "e7e5"),
      line({ cp: 20 }, "g1f3"),
      line({ cp: 10 }, "b8c6"),
      line({ cp: 0 }, "f1c4"),
      line({ cp: -20 }, "g7g6", ["g7g6", "h5f3"]),
      line({ mate: 1 }, "h5f7", ["h5f7"]),
      { depth: 0, score: { mate: 0 }, bestUci: "", pvUci: [] },
    ];
    const out = pickBlunders(game, lines, { side: "both" });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ san: "Nf6", side: "black", bestSan: "g6", cpLoss: 1480, evalAfterPawns: 100 });
    expect(out[0].pvSan).toEqual(["g6", "Qf3"]);
  });
});
