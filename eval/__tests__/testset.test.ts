import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import { THEMES } from "@/prompts";
import positions from "../positions.json";
import raw from "../raw-puzzles.json";
import { uciLineToSan } from "@/lib/chess/pgn";
import { pickCandidates, parsePuzzleCsv, puzzlePosition, type RawPuzzle } from "../lichess";
import { mapLichessThemes } from "../theme-map";
import type { TestPosition } from "../types";

const set = positions as TestPosition[];

describe("eval/positions.json", () => {
  it("has 40 unique positions", () => {
    expect(set).toHaveLength(40);
    expect(new Set(set.map((p) => p.puzzleId)).size).toBe(40);
  });

  it("covers a spread of themes and ratings", () => {
    expect(new Set(set.map((p) => p.expectedTheme)).size).toBeGreaterThanOrEqual(8);
    for (const p of set) {
      expect(p.rating).toBeGreaterThanOrEqual(1000);
      expect(p.rating).toBeLessThanOrEqual(2200);
    }
  });

  it("stores consistent, legal blunders that match their source puzzle", () => {
    const byId = new Map((raw as RawPuzzle[]).map((r) => [r.puzzleId, r]));
    for (const p of set) {
      const b = p.blunder;
      expect(THEMES).toContain(p.expectedTheme);
      expect(p.expectedTheme).toBe(mapLichessThemes(p.lichessThemes));
      expect(b.cpLoss).toBeGreaterThanOrEqual(100);
      expect(b.uci).not.toBe(b.bestUci);
      const chess = new Chess(b.fenBefore);
      expect(chess.move(b.san).lan).toBe(b.uci);
      expect(chess.fen()).toBe(b.fenAfter);
      expect(b.pvSan[0]).toBe(b.bestSan);
      expect(b.refutationSan.length).toBeGreaterThan(0);
      expect(uciLineToSan(b.fenAfter, b.refutationUci, 5)).toEqual(b.refutationSan);
      const source = byId.get(p.puzzleId)!;
      expect(puzzlePosition(source).fenBefore).toBe(b.fenBefore);
      expect(source.solution).toEqual(p.solutionUci);
    }
  });
});

describe("puzzlePosition", () => {
  it("treats the move at initialPly as the blunder and checks the solution", () => {
    const p: RawPuzzle = {
      puzzleId: "test",
      gameId: "g",
      rating: 1200,
      themes: ["mateIn1"],
      initialPly: 4,
      solution: ["h5f7"],
      moves: "e4 e5 Qh5 Nc6 Bc4 Nf6",
    };
    expect(() => puzzlePosition(p)).toThrow(/expected 5 moves/);
    const ok = { ...p, moves: "e4 e5 Qh5 Nc6 Bc4", initialPly: 4, solution: ["g8f6"] };
    const pos = puzzlePosition(ok);
    expect(pos.blunderSan).toBe("Bc4");
    expect(pos.blunderUci).toBe("f1c4");
    expect(() => puzzlePosition({ ...ok, solution: ["e1e8"] })).toThrow();
  });
});

describe("pickCandidates", () => {
  const csv = [
    "PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags",
    "a,x,y,1050,75,95,5000,fork middlegame,u,",
    "b,x,y,1900,75,95,5000,fork,u,",
    "c,x,y,2100,75,95,5000,fork,u,",
    "d,x,y,1500,75,50,5000,fork,u,",
    "e,x,y,1500,75,95,5000,pin,u,",
  ].join("\n");

  it("filters by theme and quality and spreads over the rating range", () => {
    const rows = parsePuzzleCsv(csv);
    expect(rows).toHaveLength(5);
    expect(pickCandidates(rows, "fork", 2, new Set()).map((r) => r.puzzleId)).toEqual(["a", "b"]);
    expect(pickCandidates(rows, "fork", 2, new Set(["a"])).map((r) => r.puzzleId)).toEqual(["b", "c"]);
  });
});
