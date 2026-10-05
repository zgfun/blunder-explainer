/**
 * The sample game behind the one-click demo.
 *
 *   pnpm tsx scripts/precompute-sample.ts           # cache Claude explanations for its blunders (needs ANTHROPIC_API_KEY + DB)
 *   pnpm tsx scripts/precompute-sample.ts --lines   # re-fetch the game from chess.com and recompute lib/sample-data.json
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "dotenv";
import { pickBlunders } from "@/lib/chess/analysis";
import { parsePgn } from "@/lib/chess/pgn";
import type { Blunder, EngineLine } from "@/lib/chess/types";
import { CURRENT_PROMPT, LEVELS } from "@/prompts";

config({ path: [".env.local", ".env"], quiet: true });

const ROOT = path.resolve(__dirname, "..");
const DATA_FILE = path.join(ROOT, "lib/sample-data.json");
const DEPTH = 16;
const SAMPLE_URL = "https://www.chess.com/game/live/184675797960";
const SAMPLE_USERNAME = "gothamchess";
const SAMPLE_NOTE =
  "GothamChess (2928) vs BeztDonut (2756), 3+0 blitz on chess.com, 1 October 2026. An offbeat 1.Nh3 opening; " +
  "both sides go wrong around move 17, then Black's king walks into a mating attack.";

async function buildLines() {
  const { fetchGameByUrl } = await import("@/lib/chesscom");
  const { analyseFenNode, closeNodeEngine } = await import("@/lib/engine/node-engine");
  const game = await fetchGameByUrl(SAMPLE_URL, SAMPLE_USERNAME);
  const parsed = parsePgn(game.pgn);
  const fens = [...parsed.plies.map((p) => p.fenBefore), parsed.plies.at(-1)?.fenAfter ?? parsed.startFen];
  const lines: EngineLine[] = [];
  for (const [i, fen] of fens.entries()) {
    lines.push(await analyseFenNode(fen, DEPTH));
    process.stdout.write(`\rAnalysed ${i + 1} / ${fens.length}`);
  }
  closeNodeEngine();
  console.log();

  for (const side of ["white", "black"] as const) {
    const found = pickBlunders(parsed, lines, { side, minCpLoss: 200 });
    console.log(`${side}: ${found.map((b) => `${b.moveNumber}${b.side === "white" ? "." : "..."}${b.san} (${b.cpLoss})`).join(", ")}`);
  }
  const best = Math.max(
    ...(["white", "black"] as const).map((side) => pickBlunders(parsed, lines, { side, minCpLoss: 200 }).length),
  );
  if (best < 3) throw new Error("The sample game no longer has 3 clear blunders for either side; pick another game.");

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

  const blunders = sampleBlunders(SAMPLE_GAME.pgn, SAMPLE_LINES);
  let fresh = 0;
  for (const b of blunders) {
    for (const level of LEVELS) {
      const key = { fen: b.fenBefore, playedUci: b.uci, level, promptVersion: CURRENT_PROMPT.version };
      const label = `${b.moveNumber}${b.side === "white" ? "." : "..."}${b.san} @${level}`;
      if (await findExplanation(key)) {
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
  if (process.argv.includes("--lines")) await buildLines();
  else await precomputeExplanations();
  process.exit(0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
