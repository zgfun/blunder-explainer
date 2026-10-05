import { legalUciPrefix, materialBalance, uciLineToSan, uciToSan } from "./pgn";
import type { Blunder, EngineLine, ParsedGame, Score, Side } from "./types";

export const MATE_CP = 100000;
/**
 * Evals are clamped to this before computing loss. Without it, going from "mate in 3" to
 * "mate in 7" (still totally winning) or from +15 to mate-in-N would register as a loss of
 * tens of thousands of centipawns and drown out the genuinely instructive mistakes. Beyond
 * ±15 pawns the position is decided either way, so nothing meaningful is lost by clamping.
 */
export const LOSS_CLAMP_CP = 1500;
const MAX_PAWNS = 100;
const MAX_PV_UCI = 12;

function scoreToMoverCp(score: Score): number {
  if ("cp" in score) return score.cp;
  const n = score.mate;
  // mate 0: side to move is already checkmated.
  if (n === 0) return -MATE_CP;
  return Math.sign(n) * (MATE_CP - Math.abs(n) * 100);
}

/** Converts a side-to-move score to White's perspective; mates map to ±(100000 - |N|*100). */
export function scoreToWhiteCp(score: Score, sideToMove: Side): number {
  const v = scoreToMoverCp(score);
  return sideToMove === "white" ? v : -v;
}

/** Centipawns (White's perspective, possibly mate-encoded) to pawns, mates shown as ±100. */
export function toPawnsClamped(cp: number): number {
  if (cp >= MATE_CP / 2) return MAX_PAWNS;
  if (cp <= -MATE_CP / 2) return -MAX_PAWNS;
  const p = Math.max(-MAX_PAWNS, Math.min(MAX_PAWNS, cp / 100));
  return Math.round(p * 100) / 100;
}

function clamp(v: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, v));
}

/**
 * Loss from the mover's perspective. `before` is the engine line for the position before the
 * move (mover to play), `after` for the position after it (opponent to play).
 */
export function cpLossForMove(before: EngineLine, after: EngineLine, mover: Side): number {
  void mover;
  const beforeMover = clamp(scoreToMoverCp(before.score), LOSS_CLAMP_CP);
  const afterMover = clamp(-scoreToMoverCp(after.score), LOSS_CLAMP_CP);
  return Math.max(0, beforeMover - afterMover);
}

function moveNumberFromFen(fen: string): number {
  const n = Number(fen.split(" ")[5]);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export function buildBlunder(
  ply: ParsedGame["plies"][number],
  before: EngineLine,
  after: EngineLine,
): Blunder {
  const mover = ply.side;
  const opponent: Side = mover === "white" ? "black" : "white";
  const pvUci = legalUciPrefix(ply.fenBefore, before.pvUci.slice(0, MAX_PV_UCI));
  let bestSan = "";
  try {
    bestSan = before.bestUci ? uciToSan(ply.fenBefore, before.bestUci) : "";
  } catch {
    bestSan = "";
  }
  return {
    ply: ply.ply,
    side: mover,
    moveNumber: moveNumberFromFen(ply.fenBefore),
    san: ply.san,
    uci: ply.uci,
    fenBefore: ply.fenBefore,
    fenAfter: ply.fenAfter,
    bestUci: before.bestUci,
    bestSan,
    pvSan: uciLineToSan(ply.fenBefore, pvUci, 5),
    pvUci,
    evalBeforePawns: toPawnsClamped(scoreToWhiteCp(before.score, mover)),
    evalAfterPawns: toPawnsClamped(scoreToWhiteCp(after.score, opponent)),
    cpLoss: cpLossForMove(before, after, mover),
    materialBalance: materialBalance(ply.fenBefore),
    sideToMove: mover,
  };
}

/**
 * lines[i] is the analysis of the position BEFORE ply i; lines[plies.length] is the final
 * position. Plies without both surrounding lines are ignored.
 */
export function pickBlunders(
  game: ParsedGame,
  lines: EngineLine[],
  opts: { side: Side | "both"; count?: number; minCpLoss?: number },
): Blunder[] {
  const count = opts.count ?? 3;
  const minCpLoss = opts.minCpLoss ?? 100;
  const candidates: Blunder[] = [];
  for (const ply of game.plies) {
    if (opts.side !== "both" && ply.side !== opts.side) continue;
    const before = lines[ply.ply];
    const after = lines[ply.ply + 1];
    if (!before || !after || !before.bestUci) continue;
    if (ply.uci === before.bestUci) continue;
    const loss = cpLossForMove(before, after, ply.side);
    if (loss < minCpLoss) continue;
    candidates.push(buildBlunder(ply, before, after));
  }
  candidates.sort((a, b) => b.cpLoss - a.cpLoss || a.ply - b.ply);
  return candidates.slice(0, count);
}

/** White-perspective evals in pawns per position (length = lines.length), for the eval graph. */
export function evalSeriesPawns(game: ParsedGame, lines: EngineLine[]): number[] {
  return lines.map((line, i) => {
    const fen = i < game.plies.length ? game.plies[i].fenBefore : game.plies[game.plies.length - 1]?.fenAfter;
    const stm: Side = fen?.split(" ")[1] === "b" ? "black" : "white";
    return toPawnsClamped(scoreToWhiteCp(line.score, stm));
  });
}
