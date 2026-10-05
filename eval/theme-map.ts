import type { THEMES } from "@/prompts";

export type Theme = (typeof THEMES)[number];

/**
 * Lichess puzzle themes describe the tactic the SOLVER plays; the blunder is the move that allowed it.
 * Ordered by priority: the first matching rule wins, so specific motifs beat generic ones
 * ("backRankMate" before "mateIn2", "fork" before "kingsideAttack").
 */
export const LICHESS_THEME_RULES: ReadonlyArray<readonly [lichess: string, ours: Theme]> = [
  ["backRankMate", "back rank"],
  ["fork", "fork"],
  ["skewer", "skewer"],
  ["pin", "pin"],
  ["discoveredAttack", "discovered attack"],
  ["discoveredCheck", "discovered attack"],
  ["xRayAttack", "skewer"],
  ["trappedPiece", "trapped piece"],
  ["hangingPiece", "hanging piece"],
  ["overloading", "overloaded defender"],
  ["capturingDefender", "overloaded defender"],
  ["deflection", "overloaded defender"],
  ["mateIn1", "mate threat"],
  ["mateIn2", "mate threat"],
  ["mateIn3", "mate threat"],
  ["mateIn4", "mate threat"],
  ["mateIn5", "mate threat"],
  ["mate", "mate threat"],
  ["smotheredMate", "mate threat"],
  ["exposedKing", "king safety"],
  ["kingsideAttack", "king safety"],
  ["queensideAttack", "king safety"],
  ["attackingF2F7", "king safety"],
  ["advancedPawn", "pawn structure"],
  ["promotion", "pawn structure"],
  ["pawnEndgame", "endgame technique"],
  ["rookEndgame", "endgame technique"],
  ["bishopEndgame", "endgame technique"],
  ["knightEndgame", "endgame technique"],
  ["queenEndgame", "endgame technique"],
  ["queenRookEndgame", "endgame technique"],
  ["endgame", "endgame technique"],
  ["opening", "tempo / development"],
];

export function mapLichessThemes(lichessThemes: string[]): Theme {
  const set = new Set(lichessThemes);
  for (const [lichess, ours] of LICHESS_THEME_RULES) {
    if (set.has(lichess)) return ours;
  }
  return "positional";
}

/** Every one of our themes the puzzle's tags support; the grader accepts any of these as the "right idea". */
export function acceptableThemes(lichessThemes: string[]): Theme[] {
  const set = new Set(lichessThemes);
  const out: Theme[] = [];
  for (const [lichess, ours] of LICHESS_THEME_RULES) {
    if (set.has(lichess) && !out.includes(ours)) out.push(ours);
  }
  if (out.includes("mate threat") || out.includes("back rank")) {
    if (!out.includes("king safety")) out.push("king safety");
  }
  return out.length ? out : ["positional"];
}
