import { Chess } from "chess.js";
import type { EngineLine } from "@/lib/chess/types";

/** EngineLine for a position with no legal moves, or null if the game isn't over there. */
export function terminalLine(fen: string): EngineLine | null {
  const chess = new Chess(fen);
  if (chess.moves().length > 0) return null;
  // mate 0 = side to move is checkmated; stalemate is a dead draw.
  const score = chess.isCheck() ? { mate: 0 } : { cp: 0 };
  return { depth: 0, score, bestUci: "", pvUci: [] };
}
