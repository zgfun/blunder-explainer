export type Side = "white" | "black";

// Always from the side-to-move perspective, as Stockfish reports it.
export type Score = { cp: number } | { mate: number };

export type EngineLine = {
  depth: number;
  score: Score;
  bestUci: string;
  pvUci: string[];
};

export type ParsedPly = {
  ply: number;
  san: string;
  uci: string;
  fenBefore: string;
  fenAfter: string;
  side: Side;
};

export type ParsedGame = {
  headers: Record<string, string>;
  startFen: string;
  plies: ParsedPly[];
};

export type Blunder = {
  ply: number;
  side: Side;
  moveNumber: number;
  san: string;
  uci: string;
  fenBefore: string;
  fenAfter: string;
  bestUci: string;
  bestSan: string;
  /** first 5 plies from fenBefore, SAN */
  pvSan: string[];
  pvUci: string[];
  /** white's perspective, pawns, mate clamped to ±100 */
  evalBeforePawns: number;
  /** white's perspective, pawns, mate clamped to ±100 */
  evalAfterPawns: number;
  /** mover's perspective, centipawns, >= 0 */
  cpLoss: number;
  /** e.g. "White +3 (up a knight)" */
  materialBalance: string;
  sideToMove: Side;
};
