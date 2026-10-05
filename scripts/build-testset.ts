/**
 * Builds eval/positions.json, the 40-position test set, from the Lichess puzzle database (CC0).
 *
 *   pnpm tsx scripts/build-testset.ts                  # reuse eval/raw-puzzles.json, recompute engine lines
 *   pnpm tsx scripts/build-testset.ts --csv <file>     # top up candidates from a puzzle DB CSV (see eval/README.md)
 *   pnpm tsx scripts/build-testset.ts --verify         # re-fetch every stored puzzle by id and check it matches
 *   --fetch-only                                       # stop before the engine step
 *
 * Reproducible: the raw puzzles (as returned by GET /api/puzzle/{id}) are committed in eval/raw-puzzles.json.
 */import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildBlunder } from "@/lib/chess/analysis";
import type { Blunder, EngineLine, Side } from "@/lib/chess/types";
import { acceptableThemes, mapLichessThemes, type Theme } from "@/eval/theme-map";
import type { TestPosition } from "@/eval/types";
import { fetchPuzzleById, parsePuzzleCsv, pickCandidates, puzzlePosition, type RawPuzzle } from "@/eval/lichess";

const ROOT = path.resolve(__dirname, "..");
const RAW_FILE = path.join(ROOT, "eval/raw-puzzles.json");
const OUT_FILE = path.join(ROOT, "eval/positions.json");
const DEPTH = 16;
const TARGET = 40;
const MIN_CP_LOSS = 100;

/** Lichess themes to sample, with how many candidates to draw for each (extra, since some fail the engine check). */
const ANGLES: [angle: string, count: number][] = [
  ["fork", 6],
  ["pin", 5],
  ["skewer", 5],
  ["hangingPiece", 6],
  ["backRankMate", 5],
  ["discoveredAttack", 5],
  ["trappedPiece", 5],
  ["mateIn1", 3],
  ["mateIn2", 4],
  ["deflection", 3],
  ["capturingDefender", 3],
  ["exposedKing", 3],
  ["advancedPawn", 3],
  ["rookEndgame", 3],
  ["kingsideAttack", 3],
];

async function readRaw(): Promise<RawPuzzle[]> {
  try {
    return JSON.parse(await readFile(RAW_FILE, "utf8")) as RawPuzzle[];
  } catch {
    return [];
  }
}

async function saveRaw(raw: RawPuzzle[]) {
  await writeFile(RAW_FILE, JSON.stringify(raw, null, 2) + "\n");
}

/**
 * Candidates come from the Lichess puzzle database CSV (the /api/puzzle/next endpoint is heavily
 * rate-limited for anonymous use); every pick is then fetched by id from the API, which is what we store.
 * Saves after every puzzle so a stall never loses progress; re-running tops up each theme.
 */
async function collect(existing: RawPuzzle[], csvPath: string): Promise<RawPuzzle[]> {
  const rows = parsePuzzleCsv(await readFile(csvPath, "utf8"));
  console.log(`Read ${rows.length} puzzles from ${csvPath}`);
  const byId = new Map(existing.map((p) => [p.puzzleId, p]));
  for (const [angle, count] of ANGLES) {
    const have = [...byId.values()].filter((p) => p.angle === angle).length;
    if (have >= count) continue;
    const picks = pickCandidates(rows, angle, count - have, new Set(byId.keys()));
    for (const pick of picks) {
      try {
        const fresh = { ...(await fetchPuzzleById(pick.puzzleId)), angle };
        puzzlePosition(fresh);
        byId.set(fresh.puzzleId, fresh);
        await saveRaw([...byId.values()]);
        console.log(`  ${angle}: ${fresh.puzzleId} (${fresh.rating}) ${fresh.themes.join(",")}`);
      } catch (err) {
        console.warn(`  ${angle}: ${pick.puzzleId} skipped (${(err as Error).message})`);
      }
    }
  }
  return [...byId.values()];
}

/** Re-fetches every stored puzzle by id and checks it still matches: proves the set is reproducible. */
async function verify(raw: RawPuzzle[]): Promise<void> {
  for (const p of raw) {
    const fresh = await fetchPuzzleById(p.puzzleId);
    const same = fresh.moves === p.moves && fresh.initialPly === p.initialPly && fresh.solution.join() === p.solution.join();
    console.log(`  ${p.puzzleId}: ${same ? "ok" : "MISMATCH"}`);
    if (!same) throw new Error(`Puzzle ${p.puzzleId} changed upstream`);
  }
}

function sideOf(fen: string): Side {
  return fen.split(" ")[1] === "w" ? "white" : "black";
}

export function blunderFromLines(
  fenBefore: string,
  fenAfter: string,
  san: string,
  uci: string,
  before: EngineLine,
  after: EngineLine,
): Blunder | null {
  const side = sideOf(fenBefore);
  const fullmove = Number(fenBefore.split(" ")[5]);
  const ply = (fullmove - 1) * 2 + (side === "black" ? 1 : 0);
  if (uci === before.bestUci || !before.bestUci) return null;
  return buildBlunder({ ply, san, uci, fenBefore, fenAfter, side }, before, after);
}

async function build(raw: RawPuzzle[]): Promise<TestPosition[]> {
  const { analyseFenNode } = await import("@/lib/engine/node-engine");
  const candidates: TestPosition[] = [];
  for (const [n, p] of raw.entries()) {
    const pos = puzzlePosition(p);
    const before = await analyseFenNode(pos.fenBefore, DEPTH);
    const after = await analyseFenNode(pos.fenAfter, DEPTH);
    const blunder = blunderFromLines(pos.fenBefore, pos.fenAfter, pos.blunderSan, pos.blunderUci, before, after);
    const tag = `[${n + 1}/${raw.length}] ${p.puzzleId} ${pos.blunderSan}`;
    if (!blunder || blunder.cpLoss < MIN_CP_LOSS) {
      console.log(`${tag}: not a clear blunder at depth ${DEPTH} (cpLoss ${blunder?.cpLoss ?? 0}), skipped`);
      continue;
    }
    console.log(`${tag}: cpLoss ${blunder.cpLoss}, best ${blunder.bestSan}`);
    candidates.push({
      id: `lichess-${p.puzzleId}`,
      source: "lichess-puzzle",
      puzzleId: p.puzzleId,
      rating: p.rating,
      lichessThemes: p.themes,
      expectedTheme: mapLichessThemes(p.themes),
      acceptableThemes: acceptableThemes(p.themes),
      solutionUci: p.solution,
      blunder,
    });
  }
  return select(candidates);
}

/** Round-robin over expected themes so no single motif dominates the score. */
export function select(candidates: TestPosition[], target = TARGET): TestPosition[] {
  const groups = new Map<Theme, TestPosition[]>();
  for (const c of [...candidates].sort((a, b) => a.puzzleId.localeCompare(b.puzzleId))) {
    groups.set(c.expectedTheme, [...(groups.get(c.expectedTheme) ?? []), c]);
  }
  const picked: TestPosition[] = [];
  for (let round = 0; picked.length < target && picked.length < candidates.length; round++) {
    for (const group of groups.values()) {
      if (round < group.length && picked.length < target) picked.push(group[round]);
    }
  }
  return picked.sort((a, b) => a.rating - b.rating || a.puzzleId.localeCompare(b.puzzleId));
}

async function main() {
  let raw = await readRaw();
  const csvIdx = process.argv.indexOf("--csv");
  if (csvIdx > 0) {
    console.log("Collecting candidate puzzles (verified by id against lichess.org)...");
    raw = await collect(raw, process.argv[csvIdx + 1]);
    await saveRaw(raw);
    console.log(`Saved ${raw.length} raw puzzles to eval/raw-puzzles.json`);
  }
  if (process.argv.includes("--verify")) {
    console.log("Verifying every puzzle by id against lichess.org...");
    await verify(raw);
  }
  if (process.argv.includes("--fetch-only")) return;
  const positions = await build(raw);
  if (positions.length < TARGET) {
    console.warn(`Only ${positions.length} usable positions; run again with --fetch to collect more candidates.`);
  }
  await writeFile(OUT_FILE, JSON.stringify(positions, null, 2) + "\n");
  const counts = new Map<string, number>();
  for (const p of positions) counts.set(p.expectedTheme, (counts.get(p.expectedTheme) ?? 0) + 1);
  console.log(`Wrote ${positions.length} positions to eval/positions.json`);
  console.table(Object.fromEntries(counts));
  process.exit(0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
