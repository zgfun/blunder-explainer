import { describe, expect, it } from "vitest";
import { positionCommand, terminalLine, terminalLineForGame } from "../terminal";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const SHUFFLE = ["g1f3", "g8f6", "f3g1", "f6g8"];

describe("terminalLineForGame", () => {
  it("scores a threefold repetition as a draw that a lone FEN can't see", () => {
    const moves = [...SHUFFLE, ...SHUFFLE];
    const history = { startFen: START, moves };
    expect(terminalLineForGame(history)).toEqual({ depth: 0, score: { cp: 0 }, bestUci: "", pvUci: [] });
    expect(terminalLine(START)).toBeNull();
  });

  it("returns null for a game still in progress and mate 0 for checkmate", () => {
    expect(terminalLineForGame({ startFen: START, moves: SHUFFLE })).toBeNull();
    const mate = terminalLineForGame({ startFen: START, moves: ["f2f3", "e7e5", "g2g4", "d8h4"] });
    expect(mate?.score).toEqual({ mate: 0 });
  });

  it("scores insufficient material as a draw", () => {
    expect(terminalLineForGame({ startFen: "8/8/8/4k3/8/8/2N5/4K3 w - - 0 60", moves: [] })?.score).toEqual({ cp: 0 });
  });
});

describe("positionCommand", () => {
  it("includes the moves when a history is given", () => {
    expect(positionCommand(START)).toBe(`position fen ${START}`);
    expect(positionCommand("x", { startFen: START, moves: ["e2e4", "e7e5"] })).toBe(`position fen ${START} moves e2e4 e7e5`);
    expect(positionCommand(START, { startFen: START, moves: [] })).toBe(`position fen ${START}`);
  });
});
