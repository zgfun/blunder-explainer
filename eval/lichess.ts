import { Chess } from "chess.js";

/** The subset of a Lichess puzzle we keep. Player names are dropped on purpose: nothing personal is stored. */
export type RawPuzzle = {
  puzzleId: string;
  gameId: string;
  rating: number;
  themes: string[];
  initialPly: number;
  solution: string[];
  /** Space-separated SAN moves of the source game up to and including the blunder. */
  moves: string;
  /** The Lichess theme this candidate was selected for (collection bookkeeping only). */
  angle?: string;
};

type ApiPuzzle = {
  game: { id: string; pgn: string };
  puzzle: { id: string; rating: number; themes: string[]; initialPly: number; solution: string[] };
};

const UA = "BlunderExplainer/1.0 (portfolio eval set builder)";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let lastRequest = 0;

/** Sequential, >= 1.5s apart, exponential backoff on 429 as Lichess asks. */
async function lichessGet(url: string): Promise<unknown> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const wait = lastRequest + 1500 - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequest = Date.now();
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": UA },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 429) {
      console.warn(`  429 from Lichess, waiting ${90 * (attempt + 1)}s`);
      await sleep(90_000 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error(`Lichess ${res.status} for ${url}`);
    return res.json();
  }
  throw new Error(`Lichess kept rate-limiting ${url}`);
}

function toRaw(data: ApiPuzzle): RawPuzzle {
  return {
    puzzleId: data.puzzle.id,
    gameId: data.game.id,
    rating: data.puzzle.rating,
    themes: data.puzzle.themes,
    initialPly: data.puzzle.initialPly,
    solution: data.puzzle.solution,
    moves: data.game.pgn,
  };
}

export async function fetchPuzzleById(id: string): Promise<RawPuzzle> {
  return toRaw((await lichessGet(`https://lichess.org/api/puzzle/${encodeURIComponent(id)}`)) as ApiPuzzle);
}

export type PuzzlePosition = { fenBefore: string; blunderSan: string; blunderUci: string; fenAfter: string };

/**
 * In a Lichess puzzle, the game move at index `initialPly` is the opponent's mistake; the solution
 * starts from the position after it. Throws if the data is inconsistent (e.g. solution illegal).
 */
export function puzzlePosition(p: RawPuzzle): PuzzlePosition {
  const sans = p.moves.trim().split(/\s+/);
  if (sans.length !== p.initialPly + 1) {
    throw new Error(`puzzle ${p.puzzleId}: expected ${p.initialPly + 1} moves, got ${sans.length}`);
  }
  const chess = new Chess();
  for (const san of sans.slice(0, p.initialPly)) chess.move(san);
  const fenBefore = chess.fen();
  const move = chess.move(sans[p.initialPly]);
  const fenAfter = chess.fen();
  const check = new Chess(fenAfter);
  for (const uci of p.solution) {
    check.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  }
  return { fenBefore, blunderSan: move.san, blunderUci: move.from + move.to + (move.promotion ?? ""), fenAfter };
}

export type CsvPuzzle = { puzzleId: string; rating: number; deviation: number; popularity: number; plays: number; themes: string[] };

/** Parses rows of the Lichess puzzle database CSV (database.lichess.org, CC0). Only the columns we select on. */
export function parsePuzzleCsv(csv: string): CsvPuzzle[] {
  const out: CsvPuzzle[] = [];
  for (const line of csv.split("\n")) {
    const cols = line.split(",");
    if (cols.length < 9 || cols[0] === "PuzzleId") continue;
    out.push({
      puzzleId: cols[0],
      rating: Number(cols[3]),
      deviation: Number(cols[4]),
      popularity: Number(cols[5]),
      plays: Number(cols[6]),
      themes: cols[7].split(" ").filter(Boolean),
    });
  }
  return out;
}

/**
 * Deterministic pick of `count` well-established puzzles tagged `theme`, spread evenly over the
 * rating range so the set isn't all easy or all hard.
 */
export function pickCandidates(
  rows: CsvPuzzle[],
  theme: string,
  count: number,
  exclude: Set<string>,
  range: [number, number] = [1000, 2200],
): CsvPuzzle[] {
  const pool = rows.filter(
    (r) =>
      r.themes.includes(theme) &&
      !exclude.has(r.puzzleId) &&
      r.rating >= range[0] &&
      r.rating <= range[1] &&
      r.popularity >= 90 &&
      r.plays >= 1000 &&
      r.deviation <= 80,
  );
  const picked: CsvPuzzle[] = [];
  const step = (range[1] - range[0]) / count;
  for (let i = 0; i < count; i++) {
    const target = range[0] + step * (i + 0.5);
    let best: CsvPuzzle | null = null;
    for (const r of pool) {
      if (picked.includes(r)) continue;
      if (!best || Math.abs(r.rating - target) < Math.abs(best.rating - target)) best = r;
    }
    if (best) picked.push(best);
  }
  return picked;
}
