/**
 * The sample game behind the one-click demo.
 *
 *   pnpm tsx scripts/precompute-sample.ts                   # cache Claude explanations for its blunders (needs ANTHROPIC_API_KEY + DB)
 *   pnpm tsx scripts/precompute-sample.ts --force           # ...regenerating rows that already exist
 *   pnpm tsx scripts/precompute-sample.ts --lines           # re-fetch the game from chess.com and recompute lib/sample-data.json
 *   pnpm tsx scripts/precompute-sample.ts --lines --offline # recompute the engine lines for the stored PGN only
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "dotenv";
import { pickBlunders } from "@/lib/chess/analysis";
import { parsePgn } from "@/lib/chess/pgn";
import type { Blunder, EngineLine } from "@/lib/chess/types";
import { LEVELS } from "@/prompts";

config({ path: [".env.local", ".env"], quiet: true });

const ROOT = path.resolve(__dirname, "..");
const DATA_FILE = path.join(ROOT, "lib/sample-data.json");
const DEPTH = 16;
const SAMPLE_URL = "https://www.chess.com/game/live/184675797960";
const SAMPLE_USERNAME = "gothamchess";
const SAMPLE_NOTE =
  "GothamChess (2928) vs BeztDonut (2756), 3+0 blitz on chess.com, 1 October 2026. An offbeat 1.Nh3 opening; " +
  "both sides go wrong around move 17, then Black's king walks into a mating attack.";

async function loadGame(offline: boolean) {
  if (offline) {
    const { readFile } = await import("node:fs/promises");
    const stored = JSON.parse(await readFile(DATA_FILE, "utf8")) as {
      id: string;
      url: string;
      pgn: string;
      white: string;
      black: string;
      whiteElo: number | null;
      blackElo: number | null;
      timeClass: string;
      endTime: number;
    };
    return {
      ...stored,
      id: stored.id.replace(/^chesscom:/, ""),
      whiteElo: stored.whiteElo ?? undefined,
      blackElo: stored.blackElo ?? undefined,
    };
  }
  const { fetchGameByUrl } = await import("@/lib/chesscom");
  return fetchGameByUrl(SAMPLE_URL, SAMPLE_USERNAME);
}

async function buildLines(offline: boolean) {
  const { analyseFenNode, closeNodeEngine } = await import("@/lib/engine/node-engine");
  const game = await loadGame(offline);
  const parsed = parsePgn(game.pgn);
  const fens = [...parsed.plies.map((p) => p.fenBefore), parsed.plies.at(-1)?.fenAfter ?? parsed.startFen];
  const moves = parsed.plies.map((p) => p.uci);
  const lines: EngineLine[] = [];
  for (const [i, fen] of fens.entries()) {
    lines.push(await analyseFenNode(fen, DEPTH, { startFen: parsed.startFen, moves: moves.slice(0, i) }));
    process.stdout.write(`\rAnalysed ${i + 1} / ${fens.length}`);
  }
  closeNodeEngine();
  console.log();

  for (const side of ["white", "black", "both"] as const) {
    const found = pickBlunders(parsed, lines, { side, minCpLoss: 200 });
    console.log(`${side}: ${found.map((b) => `${b.moveNumber}${b.side === "white" ? "." : "..."}${b.san} (${b.cpLoss})`).join(", ")}`);
  }
  // The demo opens on "both", so that view must show three clear (> 2 pawn, result-changing) mistakes.
  if (pickBlunders(parsed, lines, { side: "both", minCpLoss: 200 }).length < 3) {
    throw new Error("The sample game no longer has 3 clear blunders; pick another game.");
  }

  const data = {
    id: `chesscom:${game.id}`,
    url: game.url,
    white: game.white,
    black: game.black,
    whiteElo: game.whiteElo ?? null,
    blackElo: game.blackElo ?? null,
    timeClass: game.timeClass,
    endTime: game.endTime,
    note: SAMPLE_NOTE,
    pgn: game.pgn,
    engine: "stockfish-19-lite-single",
    depth: DEPTH,
    lines,
  };
  await writeFile(DATA_FILE, JSON.stringify(data, null, 2) + "\n");
  console.log(`Wrote ${lines.length} engine lines to lib/sample-data.json`);
}

/** Every blunder the demo can show: the top 3 for White, for Black and for both sides together. */
export function sampleBlunders(pgn: string, lines: EngineLine[]): Blunder[] {
  const game = parsePgn(pgn);
  const byPly = new Map<number, Blunder>();
  for (const side of ["white", "black", "both"] as const) {
    for (const b of pickBlunders(game, lines, { side })) byPly.set(b.ply, b);
  }
  return [...byPly.values()].sort((a, b) => a.ply - b.ply);
}

async function precomputeExplanations() {
  const { getClient } = await import("@/lib/llm/client");
  const client = getClient();
  if (!client) {
    console.log(
      "ANTHROPIC_API_KEY is not set, so no explanations were generated.\n" +
        "Set it in .env.local and re-run to cache the sample game's explanations (all 3 levels) in the explanations table.",
    );
    return;
  }
  if (!process.env.DATABASE_URL) {
    console.log("DATABASE_URL is not set; there is nowhere to cache the explanations. Nothing done.");
    return;
  }
  const { SAMPLE_GAME, SAMPLE_LINES } = await import("@/lib/sample");
  const { explainText } = await import("@/lib/llm/explain");
  const { findExplanation, saveExplanation } = await import("@/lib/llm/cache");
  const { explanationKey } = await import("@/lib/llm/key");
  const force = process.argv.includes("--force");

  const blunders = sampleBlunders(SAMPLE_GAME.pgn, SAMPLE_LINES);
  let fresh = 0;
  for (const b of blunders) {
    for (const level of LEVELS) {
      // The key hashes the exact prompt, so an existing row was written from these same inputs.
      const key = explanationKey(b, level);
      const label = `${b.moveNumber}${b.side === "white" ? "." : "..."}${b.san} @${level}`;
      if (!force && (await findExplanation(key))) {
        console.log(`${label}: cached`);
        continue;
      }
      const result = await explainText(b, level, { client });
      if (result.truncated) {
        console.warn(`${label}: hit max_tokens, not cached`);
        continue;
      }
      await saveExplanation(key, {
        rawText: result.text,
        model: result.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      });
      fresh++;
      console.log(`${label}: saved (${result.outputTokens} output tokens)`);
    }
  }
  console.log(`Done: ${fresh} new explanations for ${blunders.length} blunders x ${LEVELS.length} levels.`);
}

async function main() {
  if (process.argv.includes("--lines")) await buildLines(process.argv.includes("--offline"));
  else await precomputeExplanations();
  process.exit(0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
