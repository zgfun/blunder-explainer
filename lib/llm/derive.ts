import { Chess } from "chess.js";
import { LOSS_CLAMP_CP, toPawnsClamped } from "../chess/analysis";
import { legalUciPrefix, materialBalance, sideToMove, uciLineToSan, uciToSan } from "../chess/pgn";
import type { Blunder } from "../chess/types";

export const MAX_PV_UCI = 12;
/** Below this the move isn't worth an LLM call; stops arbitrary positions draining the budget. */
export const MIN_EXPLAIN_CP_LOSS = 50;

export type ExplainInput = {
  fenBefore: string;
  playedUci: string;
  bestUci: string;
  pvUci: string[];
  /** Engine line from the position after the played move (the punishment); optional. */
  refutationUci?: string[];
  /** White's perspective, centipawns (mate-encoded values are fine; they clamp to ±100 pawns). */
  evalBeforeCp: number;
  evalAfterCp: number;
};

export type DeriveErrorCode = "invalid-fen" | "game-over" | "illegal-move" | "illegal-best-move" | "not-a-mistake";

export class DeriveError extends Error {
  constructor(
    public code: DeriveErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DeriveError";
  }
}

function clamp(v: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, v));
}

/**
 * Rebuilds a Blunder from untrusted client input. Only the FEN, UCI moves and two numbers are
 * accepted; every string that reaches the prompt (SAN, side, material) is recomputed here.
 */
export function deriveBlunder(input: ExplainInput): Blunder {
  let chess: Chess;
  try {
    chess = new Chess(input.fenBefore);
  } catch {
    throw new DeriveError("invalid-fen", "fenBefore is not a valid position");
  }
  const fenBefore = chess.fen();
  if (chess.moves().length === 0) throw new DeriveError("game-over", "The position has no legal moves");

  if (legalUciPrefix(fenBefore, [input.playedUci]).length !== 1) {
    throw new DeriveError("illegal-move", "playedUci is not a legal move in this position");
  }
  if (legalUciPrefix(fenBefore, [input.bestUci]).length !== 1) {
    throw new DeriveError("illegal-best-move", "bestUci is not a legal move in this position");
  }
  if (input.bestUci === input.playedUci) {
    throw new DeriveError("not-a-mistake", "The played move is the engine's best move");
  }

  const san = uciToSan(fenBefore, input.playedUci);
  const after = new Chess(fenBefore);
  after.move({ from: input.playedUci.slice(0, 2), to: input.playedUci.slice(2, 4), promotion: input.playedUci[4] });

  // A PV that doesn't start with bestUci is inconsistent; keep only the move we can vouch for.
  const line = input.pvUci[0] === input.bestUci ? input.pvUci : [input.bestUci];
  const pvUci = legalUciPrefix(fenBefore, line.slice(0, MAX_PV_UCI));
  const pvSan = uciLineToSan(fenBefore, pvUci, 5);

  const side = sideToMove(fenBefore);
  const sign = side === "white" ? 1 : -1;
  const cpLoss = Math.max(
    0,
    Math.round(clamp(input.evalBeforeCp * sign, LOSS_CLAMP_CP) - clamp(input.evalAfterCp * sign, LOSS_CLAMP_CP)),
  );
  if (cpLoss < MIN_EXPLAIN_CP_LOSS) {
    throw new DeriveError("not-a-mistake", "The evaluations show this move lost almost nothing");
  }
  const fenAfter = after.fen();
  const refutationUci = legalUciPrefix(fenAfter, (input.refutationUci ?? []).slice(0, MAX_PV_UCI));
  const fullmove = Number(fenBefore.split(" ")[5]) || 1;

  return {
    ply: (fullmove - 1) * 2 + (side === "black" ? 1 : 0),
    side,
    moveNumber: fullmove,
    san,
    uci: input.playedUci,
    fenBefore,
    fenAfter,
    bestUci: input.bestUci,
    bestSan: pvSan[0],
    pvSan,
    pvUci,
    refutationSan: uciLineToSan(fenAfter, refutationUci, 5),
    refutationUci,
    evalBeforePawns: toPawnsClamped(input.evalBeforeCp),
    evalAfterPawns: toPawnsClamped(input.evalAfterCp),
    cpLoss,
    materialBalance: materialBalance(fenBefore),
    sideToMove: side,
  };
}
