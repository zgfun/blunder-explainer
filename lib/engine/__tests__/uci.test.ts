import { describe, expect, it } from "vitest";
import { terminalLine } from "@/lib/engine/terminal";
import { parseBestMove, parseInfoLine, UciAccumulator } from "@/lib/engine/uci";

describe("parseInfoLine", () => {
  it("parses cp score and pv", () => {
    const l = parseInfoLine(
      "info depth 12 seldepth 18 multipv 1 score cp 34 nodes 123 nps 4000 hashfull 3 tbhits 0 time 30 pv e2e4 e7e5 g1f3",
    );
    expect(l).toEqual({ depth: 12, multipv: 1, score: { cp: 34 }, pv: ["e2e4", "e7e5", "g1f3"], bound: undefined });
  });

  it("parses mate scores including negative", () => {
    expect(parseInfoLine("info depth 5 score mate 2 pv a1a8")?.score).toEqual({ mate: 2 });
    expect(parseInfoLine("info depth 5 score mate -3 pv h7h6")?.score).toEqual({ mate: -3 });
  });

  it("flags bounds and ignores non-search info", () => {
    expect(parseInfoLine("info depth 10 score cp 50 upperbound nodes 1 pv d2d4")?.bound).toBe("upper");
    expect(parseInfoLine("info string NNUE evaluation using nn.nnue")).toBeNull();
    expect(parseInfoLine("info depth 3 currmove e2e4 currmovenumber 1")).toBeNull();
    expect(parseInfoLine("bestmove e2e4")).toBeNull();
  });
});

describe("parseBestMove", () => {
  it("handles normal, ponder and none", () => {
    expect(parseBestMove("bestmove e2e4 ponder e7e5")).toBe("e2e4");
    expect(parseBestMove("bestmove e7e8q")).toBe("e7e8q");
    expect(parseBestMove("bestmove (none)")).toBe("");
    expect(parseBestMove("readyok")).toBeNull();
  });
});

describe("UciAccumulator", () => {
  it("keeps the deepest multipv 1 line and returns on bestmove", () => {
    const acc = new UciAccumulator();
    expect(acc.push("info depth 1 multipv 1 score cp 10 pv d2d4")).toBeNull();
    acc.push("info depth 2 multipv 1 score cp 20 pv e2e4 e7e5");
    acc.push("info depth 2 multipv 2 score cp 15 pv d2d4 d7d5");
    acc.push("info depth 3 multipv 1 score cp 99 lowerbound pv c2c4");
    acc.push("info depth 3 multipv 1 score cp 25 pv e2e4 c7c5 g1f3");
    acc.push("info depth 3 multipv 1 score cp 60 upperbound pv e2e4");
    const out = acc.push("bestmove e2e4 ponder c7c5");
    expect(out).toEqual({ depth: 3, score: { cp: 25 }, bestUci: "e2e4", pvUci: ["e2e4", "c7c5", "g1f3"] });
  });

  it("falls back to bestmove when the pv disagrees", () => {
    const acc = new UciAccumulator();
    acc.push("info depth 4 multipv 1 score cp 5 pv g1f3 d7d5");
    expect(acc.push("bestmove d2d4")).toEqual({ depth: 4, score: { cp: 5 }, bestUci: "d2d4", pvUci: ["d2d4"] });
  });
});

describe("terminalLine", () => {
  it("returns mate 0 for checkmate, cp 0 for stalemate, null otherwise", () => {
    expect(terminalLine("R5k1/5ppp/8/8/8/8/5PPP/6K1 b - - 1 1")).toEqual({
      depth: 0,
      score: { mate: 0 },
      bestUci: "",
      pvUci: [],
    });
    expect(terminalLine("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1")?.score).toEqual({ cp: 0 });
    expect(terminalLine("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1")).toBeNull();
  });
});
