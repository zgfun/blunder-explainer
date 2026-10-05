import type { Blunder } from "@/lib/chess/types";
import type { Theme } from "@/prompts";

/** One item of eval/positions.json. */
export type TestPosition = {
  id: string;
  source: "lichess-puzzle";
  puzzleId: string;
  rating: number;
  lichessThemes: string[];
  expectedTheme: Theme;
  /** Every one of our themes the puzzle's tags support; the grader accepts any of these. */
  acceptableThemes: Theme[];
  /** The puzzle's winning line (UCI) from the position after the blunder; ground truth for the grader. */
  solutionUci: string[];
  blunder: Blunder;
};
