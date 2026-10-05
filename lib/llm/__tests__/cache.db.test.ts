import { config } from "dotenv";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SCHOLAR_INPUT } from "./fixtures";

config({ path: ".env.local", quiet: true });

vi.mock("../client", () => ({
  EXPLAIN_MODEL: "claude-sonnet-5-5",
  GRADER_MODEL: "claude-opus-5-5",
  getClient: () => null,
}));

const url = process.env.TEST_DATABASE_URL;

async function reachable(): Promise<boolean> {
  if (!url) return false;
  const sql = postgres(url, { connect_timeout: 2, max: 1, onnotice: () => {} });
  try {
    await sql`select 1`;
    return true;
  } catch {
    return false;
  } finally {
    await sql.end({ timeout: 1 });
  }
}

const available = await reachable();

describe.skipIf(!available)("explanations cache (TEST_DATABASE_URL)", () => {
  const sql = available ? postgres(url!, { max: 1, onnotice: () => {} }) : null;
  const testDb = sql ? drizzle(sql) : null;
  const key = { fen: SCHOLAR_INPUT.fenBefore, playedUci: "g8f6", level: 1000 as const, promptVersion: "v2" };

  beforeAll(async () => {
    try {
      await migrate(testDb!, { migrationsFolder: "drizzle" });
    } catch {
      // Another test file may be migrating the same database concurrently; the second run is a no-op.
      await migrate(testDb!, { migrationsFolder: "drizzle" });
    }
    // The route uses the app's lazy db, which reads DATABASE_URL on first use.
    process.env.DATABASE_URL = url;
    const { explanations } = await import("../../../db/schema");
    await testDb!
      .delete(explanations)
      .where(and(eq(explanations.fen, key.fen), eq(explanations.playedUci, key.playedUci)));
  });

  afterAll(async () => {
    await sql?.end({ timeout: 1 });
  });

  it("round-trips through saveExplanation / findExplanation", async () => {
    const { findExplanation, saveExplanation } = await import("../cache");
    expect(await findExplanation(key)).toBeNull();
    await saveExplanation(key, {
      rawText: '{"theme":"mate threat"}\nYour knight move ignores the threat on f7.',
      model: "claude-sonnet-5-5",
      inputTokens: 1000,
      outputTokens: 50,
    });
    expect(await findExplanation(key)).toEqual({
      theme: "mate threat",
      text: "Your knight move ignores the threat on f7.",
      model: "claude-sonnet-5-5",
    });
    expect(await findExplanation({ ...key, level: 2200 })).toBeNull();
    expect(await findExplanation({ ...key, promptVersion: "v1" })).toBeNull();
  });

  it("serves the cached text from the route without an API key", async () => {
    const { POST } = await import("../../../app/api/explain/route");
    const res = await POST(
      new Request("http://localhost/api/explain", {
        method: "POST",
        body: JSON.stringify({ ...SCHOLAR_INPUT, level: 1000 }),
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("x-cache")).toBe("hit");
    expect(await res.text()).toBe('{"theme":"mate threat"}\nYour knight move ignores the threat on f7.');

    const miss = await POST(
      new Request("http://localhost/api/explain", {
        method: "POST",
        body: JSON.stringify({ ...SCHOLAR_INPUT, level: 2200 }),
      }),
    );
    expect(miss.status).toBe(503);
  });
});
