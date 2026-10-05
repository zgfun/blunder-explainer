import { Chess } from "chess.js";
import type { EngineLine } from "@/lib/chess/types";

/** The moves that led to a position, so the engine and draw checks can see repetitions. */
export type GameHistory = { startFen: string; moves: string[] };

const DRAWN: EngineLine = { depth: 0, score: { cp: 0 }, bestUci: "", pvUci: [] };

/** EngineLine for a position with no legal moves, or null if the game isn't over there. */
export function terminalLine(fen: string): EngineLine | null {
  const chess = new Chess(fen);
  if (chess.moves().length > 0) return null;
  // mate 0 = side to move is checkmated; stalemate is a dead draw.
  if (chess.isCheck()) return { depth: 0, score: { mate: 0 }, bestUci: "", pvUci: [] };
  return DRAWN;
}

/**
 * Like terminalLine, but replays the game so draws a lone FEN can't show (threefold
 * repetition) also count, along with insufficient material and the fifty-move rule.
 */
export function terminalLineForGame(history: GameHistory): EngineLine | null {
  const chess = new Chess(history.startFen);
  for (const uci of history.moves) {
    chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  }
  const terminal = terminalLine(chess.fen());
  if (terminal) return terminal;
  if (chess.isThreefoldRepetition() || chess.isInsufficientMaterial() || chess.isDrawByFiftyMoves()) return DRAWN;
  return null;
}

/** UCI "position" command; with history Stockfish knows which positions already occurred. */
export function positionCommand(fen: string, history?: GameHistory): string {
  if (history && history.moves.length > 0) {
    return `position fen ${history.startFen} moves ${history.moves.join(" ")}`;
  }
  return `position fen ${fen}`;
}
