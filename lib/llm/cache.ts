import { and, count, eq, gte } from "drizzle-orm";
import { db as defaultDb, explanations } from "../../db";
import { toTheme, type Theme } from "../../prompts";
import { parseExplanation } from "./explain";

import type { ExplanationKey } from "./key";

type Db = typeof defaultDb;

export type { ExplanationKey } from "./key";

export type CachedExplanation = { theme: Theme | null; text: string; model: string };

/** The wire format the explain route streams: a JSON header line, then the prose. */
export function formatExplanation(theme: Theme | null, text: string): string {
  return `${JSON.stringify({ theme })}\n${text}`;
}

export async function findExplanation(key: ExplanationKey, database: Db = defaultDb): Promise<CachedExplanation | null> {
  const rows = await database
    .select()
    .from(explanations)
    .where(
      and(
        eq(explanations.fen, key.fen),
        eq(explanations.playedUci, key.playedUci),
        eq(explanations.level, key.level),
        eq(explanations.promptVersion, key.promptVersion),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  // Tolerate rows written with the raw model output (header line included) as well as prose only.
  const parsed = parseExplanation(row.text);
  return { theme: toTheme(row.theme) ?? parsed.theme, text: parsed.text, model: row.model };
}

/** Stores prose in `text` and the theme in its own column; the latest write wins. */
export async function saveExplanation(
  key: ExplanationKey,
  value: { rawText: string; model: string; inputTokens?: number; outputTokens?: number },
  database: Db = defaultDb,
): Promise<void> {
  const parsed = parseExplanation(value.rawText);
  const row = {
    ...key,
    model: value.model,
    theme: parsed.theme,
    text: parsed.text,
    inputTokens: value.inputTokens ?? null,
    outputTokens: value.outputTokens ?? null,
  };
  await database
    .insert(explanations)
    .values(row)
    .onConflictDoUpdate({
      target: [explanations.fen, explanations.playedUci, explanations.level, explanations.promptVersion],
      set: { model: row.model, theme: row.theme, text: row.text, inputTokens: row.inputTokens, outputTokens: row.outputTokens },
    });
}

/**
 * Explanations written since the start of the current UTC day, across every instance; backs the
 * global daily LLM cap, which an in-memory counter alone can't enforce on serverless.
 */
export async function countExplanationsToday(now = Date.now(), database: Db = defaultDb): Promise<number> {
  const start = new Date(Math.floor(now / 86_400_000) * 86_400_000);
  const rows = await database.select({ n: count() }).from(explanations).where(gte(explanations.createdAt, start));
  return Number(rows[0]?.n ?? 0);
}
