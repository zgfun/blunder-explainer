import type { Blunder } from "../chess/types";
import { parseExplanation } from "./explain";

export const MAX_WORDS = 100;

// Unambiguous move notation: piece moves, castling, pawn captures and promotions.
const SAN_RE =
  /(?<![A-Za-z0-9])(?:O-O-O|O-O|0-0-0|0-0|[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h]x[a-h][1-8](?:=?[QRBN])?|[a-h][18]=[QRBN])[+#]?(?![A-Za-z0-9])/g;

// A bare pawn push ("d4") is indistinguishable from a square ("the pawn on d4"), so it only
// counts as a move after a move number ("17.", "17...") or a verb that introduces a move.
const PAWN_PUSH_RE =
  /(?:(?<![A-Za-z])(?:[Pp]lay(?:s|ed|ing)?|[Pp]ush(?:es|ed|ing)?|[Tt]hen|[Aa]fter|[Rr]epl(?:y|ies)|[Aa]nswer(?:s|ed)?|[Mm]ove|was)\s+|\d+\.(?:\.\.)?\s*|…\s*)([a-h][1-8][+#]?)(?![=A-Za-z0-9])/g;

export function normalizeSan(san: string): string {
  return san.replace(/[+#!?]/g, "").replace(/0/g, "O").replace(/([a-h][18])([QRBN])$/, "$1=$2");
}

/** Drops disambiguation (Nbd7 → Nd7, R1e2 → Re2) so it never decides whether moves match. */
function canonicalSan(san: string): string {
  return normalizeSan(san).replace(/^([KQRBN])[a-h]?[1-8]?(x?[a-h][1-8])$/, "$1$2");
}

export function sanTokens(text: string): string[] {
  const found: { index: number; token: string }[] = [];
  for (const m of text.matchAll(SAN_RE)) found.push({ index: m.index, token: m[0] });
  for (const m of text.matchAll(PAWN_PUSH_RE)) found.push({ index: m.index + m[0].length - m[1].length, token: m[1] });
  return found.sort((a, b) => a.index - b.index).map((f) => f.token);
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
}

/**
 * Deterministic checks: every move in notation must be the played move or come from the engine
 * line or the engine reply line, and the prose stays short.
 */
export function validateExplanation(text: string, b: Blunder): { ok: boolean; problems: string[] } {
  const prose = parseExplanation(text).text;
  const allowed = new Set([b.san, b.bestSan, ...b.pvSan, ...(b.refutationSan ?? [])].filter(Boolean).map(canonicalSan));
  const problems: string[] = [];

  const invented = [...new Set(sanTokens(prose).filter((t) => !allowed.has(canonicalSan(t))))];
  if (invented.length) problems.push(`mentions moves not in the engine line: ${invented.join(", ")}`);

  const words = wordCount(prose);
  if (words > MAX_WORDS) problems.push(`too long: ${words} words (max ${MAX_WORDS})`);
  if (words === 0) problems.push("empty explanation");

  return { ok: problems.length === 0, problems };
}
