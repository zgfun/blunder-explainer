import type { Blunder } from "../chess/types";
import { parseExplanation } from "./explain";

export const MAX_WORDS = 100;

// Bare squares ("e4", "f7") are excluded on purpose: prose names squares constantly
// ("the pawn on f7"), so only unambiguous move notation counts as a mentioned move.
const SAN_RE =
  /(?<![A-Za-z0-9])(?:O-O-O|O-O|0-0-0|0-0|[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h]x[a-h][1-8](?:=?[QRBN])?|[a-h][18]=[QRBN])[+#]?(?![A-Za-z0-9])/g;

export function normalizeSan(san: string): string {
  return san.replace(/[+#!?]/g, "").replace(/0/g, "O").replace(/([a-h][18])([QRBN])$/, "$1=$2");
}

export function sanTokens(text: string): string[] {
  return text.match(SAN_RE) ?? [];
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
}

/** Deterministic checks: every move in notation must come from the given data, and the prose stays short. */
export function validateExplanation(text: string, b: Blunder): { ok: boolean; problems: string[] } {
  const prose = parseExplanation(text).text;
  const allowed = new Set([b.san, b.bestSan, ...b.pvSan].filter(Boolean).map(normalizeSan));
  const problems: string[] = [];

  const invented = [...new Set(sanTokens(prose).filter((t) => !allowed.has(normalizeSan(t))))];
  if (invented.length) problems.push(`mentions moves not in the engine line: ${invented.join(", ")}`);

  const words = wordCount(prose);
  if (words > MAX_WORDS) problems.push(`too long: ${words} words (max ${MAX_WORDS})`);
  if (words === 0) problems.push("empty explanation");

  return { ok: problems.length === 0, problems };
}
