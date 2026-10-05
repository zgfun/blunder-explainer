import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => {
  const inserts: unknown[] = [];
  const limit = vi.fn(async () => []);
  return {
    inserts,
    db: {
      select: () => ({ from: () => ({ where: () => ({ limit }) }) }),
      insert: (table: unknown) => {
        inserts.push(table);
        return { values: () => ({ onConflictDoUpdate: async () => undefined }) };
      },
    },
  };
});

vi.mock("@/db", () => ({ db: db.db, games: { id: "id" } }));

const { POST, MAX_PGN_CHARS, MAX_PLIES } = await import("../../app/api/game/route");
const { GET: getGames } = await import("../../app/api/games/route");
const { getRateLimiter } = await import("../rate-limit");

const SCHOLAR = '[White "Alice"]\n[Black "Bob"]\n\n1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7# 1-0';

function post(pgn: string, ip = "203.0.113.1") {
  return POST(
    new Request("http://localhost/api/game", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ pgn }),
    }),
  );
}

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "postgres://test");
  db.inserts.length = 0;
  getRateLimiter("games").reset();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/game", () => {
  it("returns the players and never writes the pasted PGN to the database", async () => {
    const res = await post(SCHOLAR);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ source: "pgn", white: "Alice", black: "Bob" });
    expect(body.id).toMatch(/^pgn:[0-9a-f]{16}$/);
    expect(db.inserts).toHaveLength(0);
  });

  it("rejects oversized PGNs before parsing", async () => {
    const res = await post("1. e4 e5 " + " ".repeat(MAX_PGN_CHARS));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid-pgn");
  });

  it("rejects games longer than MAX_PLIES", async () => {
    const moves: string[] = [];
    for (let i = 0; i < MAX_PLIES / 4 + 1; i++) moves.push(`${2 * i + 1}. Nf3 Nf6 ${2 * i + 2}. Ng1 Ng8`);
    const res = await post(moves.join(" "));
    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/too long/);
  });

  it("rate-limits per IP with a 429 and Retry-After", async () => {
    let last: Response | undefined;
    for (let i = 0; i < 61; i++) last = await post(SCHOLAR, "198.51.100.7");
    expect(last!.status).toBe(429);
    expect(Number(last!.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect((await last!.json()).error).toBe("too-many-requests");
    expect((await post(SCHOLAR, "198.51.100.8")).status).toBe(200);
  });
});

describe("GET /api/games", () => {
  it("shares the per-IP limit and stops calling chess.com once it is hit", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ archives: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const req = () => getGames(new Request("http://localhost/api/games?username=hikaru", { headers: { "x-forwarded-for": "192.0.2.5" } }));
    for (let i = 0; i < 60; i++) await req();
    const calls = fetchMock.mock.calls.length;
    const res = await req();
    expect(res.status).toBe(429);
    expect(fetchMock.mock.calls.length).toBe(calls);
  });
});
