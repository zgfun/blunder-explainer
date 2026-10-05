import type { Blunder, Side } from "@/lib/chess/types";

export type Level = 1000 | 1600 | 2200;
export const LEVELS: Level[] = [1000, 1600, 2200];

export type GameInput = {
  id?: string;
  url?: string;
  pgn: string;
  white: string;
  black: string;
  whiteElo?: number;
  blackElo?: number;
  timeClass?: string;
};

export function moveLabel(b: Pick<Blunder, "moveNumber" | "side" | "san" | "cpLoss">): string {
  const prefix = b.side === "white" ? `${b.moveNumber}.` : `${b.moveNumber}...`;
  return `${prefix} ${b.san}${b.cpLoss >= 300 ? "??" : "?"}`;
}

export function severity(cpLoss: number): { label: string; palette: "red" | "orange" | "yellow" } {
  if (cpLoss >= 300) return { label: "Blunder", palette: "red" };
  if (cpLoss >= 150) return { label: "Mistake", palette: "orange" };
  return { label: "Inaccuracy", palette: "yellow" };
}

/** White-perspective pawns (mate already clamped to ±100) → "+1.4", "−3.0", "#+" */
export function formatPawns(p: number): string {
  if (p >= 99.5) return "#+";
  if (p <= -99.5) return "#−";
  const r = Math.round(p * 10) / 10;
  if (r === 0) return "0.0";
  return `${r > 0 ? "+" : "−"}${Math.abs(r).toFixed(1)}`;
}

export function formatLoss(cpLoss: number): string {
  if (cpLoss >= 1500) return "−15+";
  return `−${(cpLoss / 100).toFixed(1)}`;
}

export function sideFromFen(fen: string): Side {
  return fen.split(" ")[1] === "b" ? "black" : "white";
}

export function sideOfUser(username: string | undefined, white: string, black: string): Side | undefined {
  if (!username) return undefined;
  const u = username.toLowerCase();
  if (white.toLowerCase() === u) return "white";
  if (black.toLowerCase() === u) return "black";
  return undefined;
}

/**
 * Splits a streamed explanation into its JSON header line ({"theme": ...}) and the prose.
 * Tolerates code fences or junk around the header; while the header may still be arriving
 * (no newline yet and the buffer looks like JSON) it reports pending so the UI shows nothing raw.
 */
export function splitExplanation(buffer: string, final: boolean): { theme: string | null; body: string; pending: boolean } {
  const lines = buffer.split("\n");
  const complete = final ? lines : lines.slice(0, -1);
  let i = 0;
  while (i < complete.length && (complete[i].trim() === "" || /^`{3}/.test(complete[i].trim()))) i++;
  if (i >= complete.length) {
    const head = buffer.trimStart();
    const looksLikeHeader = head === "" || head.startsWith("{") || head.startsWith("`");
    if (!final && looksLikeHeader && buffer.length < 300) return { theme: null, body: "", pending: true };
    return { theme: null, body: final ? buffer.trim() : buffer.trimStart(), pending: false };
  }
  const match = complete[i].match(/\{[^{}]*\}/);
  if (!match) return { theme: null, body: buffer.trimStart(), pending: false };
  let theme: string | null = null;
  try {
    const parsed = JSON.parse(match[0]) as { theme?: unknown };
    if (typeof parsed.theme === "string" && parsed.theme.trim()) theme = parsed.theme.trim();
  } catch {
    return { theme: null, body: buffer.trimStart(), pending: false };
  }
  let j = i + 1;
  while (j < complete.length && /^`{3}\s*$/.test(complete[j].trim())) j++;
  const rest = lines.slice(j).join("\n").replace(/^\s+/, "");
  return { theme, body: final ? rest.trim() : rest, pending: false };
}
