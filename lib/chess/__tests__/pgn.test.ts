import { describe, expect, it } from "vitest";
import { legalUciPrefix, materialBalance, parsePgn, uciLineToSan, uciToSan } from "@/lib/chess/pgn";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const CHESSCOM_PGN = `[Event "Live Chess"]
[Site "Chess.com"]
[White "alice"]
[Black "bob"]
[Result "1-0"]

1. e4 {[%clk 0:09:58.1]} 1... e5 {[%clk 0:09:57]} 2. Qh5 {[%clk 0:09:50]} 2... Nc6 3. Bc4 Nf6 4. Qxf7# 1-0`;

describe("parsePgn", () => {
  it("parses chess.com style PGN with clock comments", () => {
    const g = parsePgn(CHESSCOM_PGN);
    expect(g.headers.White).toBe("alice");
    expect(g.startFen).toBe(START);
    expect(g.plies).toHaveLength(7);
    expect(g.plies[0]).toMatchObject({ ply: 0, san: "e4", uci: "e2e4", side: "white", fenBefore: START });
    expect(g.plies[1]).toMatchObject({ ply: 1, san: "e5", uci: "e7e5", side: "black" });
    expect(g.plies[6]).toMatchObject({ san: "Qxf7#", uci: "h5f7" });
    expect(g.plies[1].fenBefore).toBe(g.plies[0].fenAfter);
  });

  it("supports custom start positions and promotions", () => {
    const g = parsePgn(`[SetUp "1"]
[FEN "8/P6k/8/8/8/8/8/K7 w - - 0 1"]

1. a8=Q *`);
    expect(g.startFen).toBe("8/P6k/8/8/8/8/8/K7 w - - 0 1");
    expect(g.plies[0]).toMatchObject({ san: "a8=Q", uci: "a7a8q" });
  });

  it("throws friendly errors", () => {
    expect(() => parsePgn("")).toThrow(/empty/);
    expect(() => parsePgn("1. e4 e5 2. Ke3 Kd8 3. Qxz9")).toThrow(/valid PGN/);
    expect(() => parsePgn("[White \"x\"]\n\n*")).toThrow(/no moves/);
  });
});

describe("uci → san", () => {
  it("converts single moves", () => {
    expect(uciToSan(START, "g1f3")).toBe("Nf3");
    expect(uciToSan("8/P6k/8/8/8/8/8/K7 w - - 0 1", "a7a8n")).toBe("a8=N");
    expect(() => uciToSan(START, "e2e5")).toThrow(/Illegal/);
  });

  it("converts a pv and stops at the first illegal move", () => {
    expect(uciLineToSan(START, ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "a7a6", "b5a4"])).toEqual([
      "e4",
      "e5",
      "Nf3",
      "Nc6",
      "Bb5",
    ]);
    expect(uciLineToSan(START, ["e2e4", "e2e4", "g1f3"])).toEqual(["e4"]);
    expect(uciLineToSan(START, ["e1g1"])).toEqual([]);
    expect(legalUciPrefix(START, ["d2d4", "d7d5", "zz", "c2c4"])).toEqual(["d2d4", "d7d5"]);
  });

  it("renders castling and checks", () => {
    const fen = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
    expect(uciLineToSan(fen, ["e1g1", "e8c8"])).toEqual(["O-O", "O-O-O"]);
  });
});

describe("materialBalance", () => {
  it("describes equal and imbalanced material", () => {
    expect(materialBalance(START)).toBe("Material is equal");
    expect(materialBalance("rnbqkb1r/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1")).toBe(
      "White +3 (up a knight)",
    );
    expect(materialBalance("rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/R1BQKBNR w KQkq - 0 1")).toBe(
      "White +6 (up a queen for a knight)",
    );
    expect(materialBalance("rnbqkbnr/pppppppp/8/8/8/8/2PPPPPP/RNBQKBNR w KQkq - 0 1")).toBe(
      "Black +2 (up two pawns)",
    );
    expect(materialBalance("rn1qkbnr/pppppppp/8/8/8/8/PPPPPPPP/R1BQKBNR w KQkq - 0 1")).toBe(
      "Material is equal (White has a bishop for a knight)",
    );
  });
});
