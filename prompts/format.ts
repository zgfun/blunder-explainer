import type { Blunder, Side } from "../lib/chess/types";

export function sideName(side: Side): string {
  return side === "white" ? "White" : "Black";
}

function other(side: Side): Side {
  return side === "white" ? "black" : "white";
}

/** Formats a mover-perspective pawn value; ±100 is the clamped stand-in for a forced mate. */
export function formatMoverEval(pawns: number, mover: Side): string {
  if (pawns >= 99.5) return `forced mate for ${sideName(mover)}`;
  if (pawns <= -99.5) return `forced mate for ${sideName(other(mover))}`;
  const rounded = Math.round(pawns * 10) / 10;
  const sign = rounded > 0 ? "+" : rounded < 0 ? "-" : "±";
  return `${sign}${Math.abs(rounded).toFixed(1)} pawns`;
}

export function moverEvals(b: Blunder): { before: number; after: number } {
  const flip = b.side === "white" ? 1 : -1;
  return { before: b.evalBeforePawns * flip, after: b.evalAfterPawns * flip };
}

export function moveLabel(b: Blunder): string {
  return `${b.moveNumber}${b.side === "white" ? "." : "..."}${b.san}`;
}
