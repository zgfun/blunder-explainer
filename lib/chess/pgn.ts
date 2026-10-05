import { Chess, DEFAULT_POSITION } from "chess.js";
import type { ParsedGame, ParsedPly, Side } from "./types";

const UCI_RE = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/;

export function parsePgn(pgn: string): ParsedGame {
  const text = (pgn ?? "").trim();
  if (!text) throw new Error("The PGN is empty. Paste a full game in PGN format.");
  const chess = new Chess();
  try {
    chess.loadPgn(text, { strict: false });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`That doesn't look like a valid PGN (${detail}).`);
  }
  const history = chess.history({ verbose: true });
  if (history.length === 0) throw new Error("The PGN contains no moves to analyse.");
  const headers = chess.getHeaders();
  const startFen = history[0].before;
  const plies: ParsedPly[] = history.map((m, i) => ({
    ply: i,
    san: m.san,
    uci: m.from + m.to + (m.promotion ?? ""),
    fenBefore: m.before,
    fenAfter: m.after,
    side: m.color === "w" ? "white" : "black",
  }));
  return { headers, startFen: startFen || DEFAULT_POSITION, plies };
}

export function sideToMove(fen: string): Side {
  return fen.split(" ")[1] === "b" ? "black" : "white";
}

function applyUci(chess: Chess, uci: string): string {
  const m = UCI_RE.exec(uci);
  if (!m) throw new Error(`Not a UCI move: ${uci}`);
  // chess.js throws on illegal moves; let it propagate.
  return chess.move({ from: m[1], to: m[2], promotion: m[3] }).san;
}

/** Throws if the move is malformed or illegal in the given position. */
export function uciToSan(fen: string, uci: string): string {
  const chess = new Chess(fen);
  try {
    return applyUci(chess, uci);
  } catch {
    throw new Error(`Illegal move ${uci} in position ${fen}`);
  }
}

/** Converts a UCI line to SAN, stopping at the first illegal move. */
export function uciLineToSan(fen: string, uciMoves: string[], maxPlies = 5): string[] {
  const chess = new Chess(fen);
  const out: string[] = [];
  for (const uci of uciMoves.slice(0, maxPlies)) {
    try {
      out.push(applyUci(chess, uci));
    } catch {
      break;
    }
  }
  return out;
}

/** Returns the longest legal prefix of uciMoves from fen. */
export function legalUciPrefix(fen: string, uciMoves: string[]): string[] {
  const chess = new Chess(fen);
  const out: string[] = [];
  for (const uci of uciMoves) {
    try {
      applyUci(chess, uci);
      out.push(uci);
    } catch {
      break;
    }
  }
  return out;
}

const VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9 } as const;
const NAMES = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen" } as const;
const NUMBERS = ["", "a", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
type PieceKey = keyof typeof VALUES;
const ORDER: PieceKey[] = ["q", "r", "b", "n", "p"];

function countPieces(fen: string): Record<"w" | "b", Record<PieceKey, number>> {
  const counts = {
    w: { p: 0, n: 0, b: 0, r: 0, q: 0 },
    b: { p: 0, n: 0, b: 0, r: 0, q: 0 },
  };
  for (const ch of fen.split(" ")[0]) {
    const lower = ch.toLowerCase();
    if (lower in VALUES) {
      counts[ch === lower ? "b" : "w"][lower as PieceKey]++;
    }
  }
  return counts;
}

function phrase(n: number, key: PieceKey): string {
  const word = NUMBERS[n] ?? String(n);
  return `${word} ${NAMES[key]}${n > 1 ? "s" : ""}`;
}

function joinAnd(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

export function materialBalance(fen: string): string {
  const c = countPieces(fen);
  let diff = 0;
  const whiteUp: string[] = [];
  const blackUp: string[] = [];
  for (const k of ORDER) {
    const d = c.w[k] - c.b[k];
    diff += d * VALUES[k];
    if (d > 0) whiteUp.push(phrase(d, k));
    if (d < 0) blackUp.push(phrase(-d, k));
  }
  if (diff === 0) {
    if (whiteUp.length === 0) return "Material is equal";
    return `Material is equal (White has ${joinAnd(whiteUp)} for ${joinAnd(blackUp)})`;
  }
  const leader = diff > 0 ? "White" : "Black";
  const ups = diff > 0 ? whiteUp : blackUp;
  const downs = diff > 0 ? blackUp : whiteUp;
  const desc = `up ${joinAnd(ups)}${downs.length ? ` for ${joinAnd(downs)}` : ""}`;
  return `${leader} +${Math.abs(diff)} (${desc})`;
}
