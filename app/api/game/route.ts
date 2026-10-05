import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, games } from "@/db";
import { parsePgn } from "@/lib/chess/pgn";
import { CHESSCOM_HTTP_STATUS, ChessComError, fetchGameByUrl, parseGameUrl, USERNAME_RE } from "@/lib/chesscom";
import { SAMPLE_GAME } from "@/lib/sample";
import { optional } from "@/lib/optional";
import { limitGameRequest } from "@/lib/rate-limit";

export const maxDuration = 30;

type GameSource = "chesscom" | "pgn" | "sample";

type GameResponse = {
  id: string;
  source: GameSource;
  pgn: string;
  white: string | null;
  black: string | null;
  url?: string;
  whiteElo?: number;
  blackElo?: number;
  endTime?: number;
  timeClass?: string;
  note?: string;
};

const getQuery = z.object({
  url: z.string().trim().min(1).max(500),
  username: z.string().trim().regex(USERNAME_RE).optional(),
});

// The longest games ever played are under 600 plies; chess.com PGNs with clock comments for such a
// game stay well under 50,000 characters.
export const MAX_PGN_CHARS = 50_000;
export const MAX_PLIES = 600;

const postBody = z.object({ pgn: z.string().min(1).max(MAX_PGN_CHARS) });

function fail(status: number, error: string, message: string) {
  return Response.json({ error, message }, { status });
}

// The cache is an optimisation: an unreachable or unconfigured DB must never fail the request or stall it.
async function withDb<T>(fn: () => Promise<T>): Promise<T | undefined> {
  if (!process.env.DATABASE_URL) return undefined;
  return optional(fn, 2000);
}

async function readCached(id: string): Promise<GameResponse | undefined> {
  const rows = await withDb(() => db.select().from(games).where(eq(games.id, id)).limit(1));
  const row = rows?.[0];
  if (!row) return undefined;
  return { id: row.id, source: row.source, pgn: row.pgn, white: row.white, black: row.black, ...row.meta };
}

async function writeCache(g: GameResponse): Promise<void> {
  const { id, source, pgn, white, black, ...meta } = g;
  await withDb(() =>
    db
      .insert(games)
      .values({ id, source, pgn, white, black, meta })
      .onConflictDoUpdate({ target: games.id, set: { pgn, white, black, meta, fetchedAt: new Date() } }),
  );
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  if (params.get("sample") === "1") {
    const s = SAMPLE_GAME;
    return Response.json({
      id: s.id,
      source: "sample",
      pgn: s.pgn,
      white: s.white,
      black: s.black,
      url: s.url,
      note: s.note,
    } satisfies GameResponse);
  }

  const q = getQuery.safeParse({ url: params.get("url") ?? "", username: params.get("username") || undefined });
  if (!q.success) {
    const badUser = q.error.issues.some((i) => i.path[0] === "username");
    return badUser
      ? fail(400, "invalid-username", "Usernames are 3-25 letters, digits, '_' or '-'.")
      : fail(400, "invalid-url", "Paste a chess.com game link.");
  }
  const parsed = parseGameUrl(q.data.url);
  if (!parsed) return fail(400, "invalid-url", "That doesn't look like a chess.com game link.");

  const id = `chesscom:${parsed.id}`;
  const cached = await readCached(id);
  if (cached) return Response.json(cached, { headers: { "X-Cache": "hit" } });

  // Only fresh lookups count: each one can fan out to several chess.com requests.
  const limited = limitGameRequest(request);
  if (limited) return limited;

  try {
    const g = await fetchGameByUrl(q.data.url, q.data.username);
    const body: GameResponse = {
      id,
      source: "chesscom",
      pgn: g.pgn,
      white: g.white,
      black: g.black,
      url: g.url,
      whiteElo: g.whiteElo,
      blackElo: g.blackElo,
      endTime: g.endTime,
      timeClass: g.timeClass,
    };
    await writeCache(body);
    return Response.json(body, { headers: { "X-Cache": "miss" } });
  } catch (e) {
    if (e instanceof ChessComError) return fail(CHESSCOM_HTTP_STATUS[e.code], e.code, e.message);
    return fail(502, "upstream", "Something went wrong talking to chess.com.");
  }
}

/**
 * Parses a pasted PGN and returns the players. Nothing is stored: the browser already has the PGN,
 * so a server copy would only let anonymous callers fill the database.
 */
export async function POST(request: Request) {
  const limited = limitGameRequest(request);
  if (limited) return limited;

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return fail(400, "invalid-body", "Send JSON like {\"pgn\": \"...\"}.");
  }
  const b = postBody.safeParse(json);
  if (!b.success) return fail(400, "invalid-pgn", "Paste a single game's PGN (up to 50,000 characters).");

  const pgn = b.data.pgn.trim();
  let parsed: ReturnType<typeof parsePgn>;
  try {
    parsed = parsePgn(pgn);
  } catch (e) {
    return fail(400, "invalid-pgn", e instanceof Error ? e.message : "That PGN could not be read.");
  }
  if (parsed.plies.length > MAX_PLIES) {
    return fail(400, "invalid-pgn", `That game is too long to analyse (over ${MAX_PLIES} half-moves).`);
  }
  const { headers } = parsed;

  const hash = createHash("sha256").update(pgn).digest("hex").slice(0, 16);
  const clean = (v: string | undefined) => (v && v !== "?" ? v : null);
  const body: GameResponse = {
    id: `pgn:${hash}`,
    source: "pgn",
    pgn,
    white: clean(headers.White),
    black: clean(headers.Black),
  };
  return Response.json(body);
}
