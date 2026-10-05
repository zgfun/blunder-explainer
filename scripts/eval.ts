/**
 * Grades Claude's explanations on the 40-position test set and reports the share rated correct.
 *
 *   pnpm tsx scripts/eval.ts [--prompt v1|v2] [--level 1000|1600|2200] [--limit N] [--timestamp ID] [--concurrency 4]
 *
 * Explanations are cached in the explanations table (when DATABASE_URL works), so re-runs only pay for grading.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "dotenv";
import { CURRENT_PROMPT, LEVELS, PROMPTS, type Level, type PromptVersion } from "@/prompts";
import type { ExplanationCache } from "@/eval/run";
import type { TestPosition } from "@/eval/types";

config({ path: [".env.local", ".env"], quiet: true });

const ROOT = path.resolve(__dirname, "..");

export type EvalArgs = { prompt: PromptVersion; level: Level; limit: number | null; timestamp: string; concurrency: number };

export function parseArgs(argv: string[], now = new Date()): EvalArgs {
  const get = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const prompt = (get("prompt") ?? CURRENT_PROMPT.version) as PromptVersion;
  if (!(prompt in PROMPTS)) throw new Error(`--prompt must be one of ${Object.keys(PROMPTS).join(", ")}`);
  const level = Number(get("level") ?? 1600) as Level;
  if (!LEVELS.includes(level)) throw new Error(`--level must be one of ${LEVELS.join(", ")}`);
  const limitRaw = get("limit");
  const limit = limitRaw ? Number(limitRaw) : null;
  if (limit !== null && !(Number.isInteger(limit) && limit > 0)) throw new Error("--limit must be a positive integer");
  const concurrency = Number(get("concurrency") ?? 4);
  const timestamp = get("timestamp") ?? now.toISOString().replace(/[:.]/g, "-");
  if (!/^[\w-]+$/.test(timestamp)) throw new Error("--timestamp may only contain letters, digits, _ and -");
  return { prompt, level, limit, timestamp, concurrency };
}

async function openDb() {
  if (!process.env.DATABASE_URL) return null;
  try {
    const { db } = await import("@/db");
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`select 1`);
    return db;
  } catch (err) {
    console.warn(`Database unavailable (${(err as Error).message}); running without the explanation cache.`);
    return null;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { getClient } = await import("@/lib/llm/client");
  const client = getClient();
  if (!client) {
    console.log(
      "ANTHROPIC_API_KEY is not set, so the eval cannot generate or grade explanations.\n" +
        "Add it to .env.local and re-run: pnpm eval --prompt v2 --level 1600",
    );
    process.exit(0);
  }

  const { runEval, formatTable } = await import("@/eval/run");
  const all = JSON.parse(await readFile(path.join(ROOT, "eval/positions.json"), "utf8")) as TestPosition[];
  const positions = args.limit ? all.slice(0, args.limit) : all;
  const prompt = PROMPTS[args.prompt];

  const database = await openDb();
  let cache: ExplanationCache | null = null;
  if (database) {
    const { findExplanation, saveExplanation } = await import("@/lib/llm/cache");
    cache = { find: (k) => findExplanation(k, database), save: (k, v) => saveExplanation(k, v, database) };
  }

  console.log(`Evaluating prompt ${prompt.version} at level ${args.level} on ${positions.length} positions...`);
  const summary = await runEval({
    positions,
    prompt,
    level: args.level,
    client,
    cache,
    concurrency: args.concurrency,
    onResult: (r, done, total) =>
      console.log(`[${done}/${total}] ${r.puzzleId} ${r.correct ? "PASS" : "fail"}${r.cached ? " (cached)" : ""}`),
  });

  console.log("\n" + formatTable(summary));

  const runId = `${summary.promptVersion}-${args.timestamp}`;
  const outDir = path.join(ROOT, "eval/results");
  await mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, `${runId}.json`);
  await writeFile(outFile, JSON.stringify({ id: runId, ranAt: new Date().toISOString(), ...summary }, null, 2) + "\n");
  console.log(`\nWrote ${path.relative(ROOT, outFile)}`);

  if (database) {
    try {
      const { evalRuns } = await import("@/db");
      await database
        .insert(evalRuns)
        .values({
          id: runId,
          promptVersion: summary.promptVersion,
          model: summary.model,
          graderModel: summary.graderModel,
          positions: summary.positions,
          score: summary.score,
          results: summary.results,
        })
        .onConflictDoNothing();
      console.log(`Recorded run ${runId} in eval_runs.`);
    } catch (err) {
      console.warn(`Could not record the run in eval_runs: ${(err as Error).message}`);
    }
  }
  process.exit(0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
