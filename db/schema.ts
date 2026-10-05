import { integer, jsonb, pgTable, primaryKey, real, text, timestamp } from "drizzle-orm/pg-core";

/** A fetched game, keyed by source + id, e.g. "chesscom:184830086652" or "pgn:<sha256>". */
export const games = pgTable("games", {
  id: text("id").primaryKey(),
  source: text("source").$type<"chesscom" | "pgn" | "sample">().notNull(),
  pgn: text("pgn").notNull(),
  white: text("white"),
  black: text("black"),
  meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One explanation per (position, played move, level, prompt version). Repeated demos cost nothing,
 * and bumping the prompt version invalidates old text without deleting it.
 */
export const explanations = pgTable(
  "explanations",
  {
    fen: text("fen").notNull(),
    playedUci: text("played_uci").notNull(),
    level: integer("level").notNull(), // 1000 | 1600 | 2200
    promptVersion: text("prompt_version").notNull(),
    model: text("model").notNull(),
    theme: text("theme"),
    text: text("text").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    /** Whose key generated it: only "server" rows count toward the global daily cap. */
    paidBy: text("paid_by").$type<"server" | "visitor">().notNull().default("server"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.fen, t.playedUci, t.level, t.promptVersion] })],
);

/** One row per eval run, so the README can show score history across prompt versions. */
export const evalRuns = pgTable("eval_runs", {
  id: text("id").primaryKey(),
  promptVersion: text("prompt_version").notNull(),
  model: text("model").notNull(),
  graderModel: text("grader_model").notNull(),
  positions: integer("positions").notNull(),
  score: real("score").notNull(), // 0..1 share rated correct
  results: jsonb("results").$type<unknown[]>().notNull(),
  ranAt: timestamp("ran_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Game = typeof games.$inferSelect;
export type Explanation = typeof explanations.$inferSelect;
export type EvalRun = typeof evalRuns.$inferSelect;
