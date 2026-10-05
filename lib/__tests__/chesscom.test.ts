import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  candidateMonths,
  ChessComError,
  fetchGameByUrl,
  findGameInArchive,
  listRecentGames,
  parseGameUrl,
  readCallback,
} from "../chesscom";

const FIX = join(__dirname, "fixtures", "chesscom");
const fixture = (name: string): unknown => JSON.parse(readFileSync(join(FIX, name), "utf8"));

type Route = { status: number; body: unknown };
let routes: Record<string, Route>;
let calls: string[];

function mockFetch() {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      expect(new Headers(init?.headers).get("User-Agent")).toMatch(/^BlunderExplainer\/1\.0 \(\+contact: /);
      const r = routes[url] ?? { status: 404, body: { code: 0, message: "not found" } };
      return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
    }),
  );
}

const PUB = "https://api.chess.com/pub/player";
const ok = (name: string): Route => ({ status: 200, body: fixture(name) });

beforeEach(() => {
  routes = {};
  mockFetch();
});
afterEach(() => vi.unstubAllGlobals());

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ChessComError);
    return (e as ChessComError).code;
  }
  throw new Error("expected rejection");
}

describe("parseGameUrl", () => {
  it.each([
    ["https://www.chess.com/game/live/184627853334", { kind: "live", id: "184627853334" }],
    ["chess.com/game/live/184627853334", { kind: "live", id: "184627853334" }],
    ["www.chess.com/game/daily/1033338800", { kind: "daily", id: "1033338800" }],
    ["https://www.chess.com/live/game/184627853334", { kind: "live", id: "184627853334" }],
    ["https://www.chess.com/daily/game/1033338800?tab=review", { kind: "daily", id: "1033338800" }],
    ["https://www.chess.com/analysis/game/live/184627853334?tab=analysis&move=12", { kind: "live", id: "184627853334" }],
    ["https://www.chess.com/analysis/game/daily/1033338800", { kind: "daily", id: "1033338800" }],
    ["http://chess.com/game/live/123456/", { kind: "live", id: "123456" }],
    ["  https://www.chess.com/game/live/123456#moves  ", { kind: "live", id: "123456" }],
    ["https://m.chess.com/game/live/123456", { kind: "live", id: "123456" }],
    ["https://www.chess.com/game/123456", { kind: "live", id: "123456" }],
    ["HTTPS://WWW.CHESS.COM/GAME/DAILY/42", { kind: "daily", id: "42" }],
  ])("accepts %s", (input, expected) => {
    expect(parseGameUrl(input)).toEqual(expected);
  });

  it.each([
    "",
    "hello",
    "https://lichess.org/abcdEFGH",
    "https://www.chess.com/member/hikaru",
    "https://www.chess.com/game/live/abc",
    "https://evilchess.com/game/live/123",
    "https://chess.com.evil.io/game/live/123",
    "https://www.chess.com/game/live/123/extra",
  ])("rejects %j", (input) => {
    expect(parseGameUrl(input)).toBeNull();
  });
});

describe("archive helpers", () => {
  it("matches games by kind and id, not by substring", () => {
    const { games } = fixture("archive-hikaru-2026-09.json") as { games: Parameters<typeof findGameInArchive>[0] };
    expect(findGameInArchive(games, "live", "184627853334")?.url).toBe("https://www.chess.com/game/live/184627853334");
    expect(findGameInArchive(games, "daily", "184627853334")).toBeUndefined();
    expect(findGameInArchive(games, "live", "18462785333")).toBeUndefined();
  });

  it("tries the end month first, then neighbours across year boundaries", () => {
    expect(candidateMonths(Date.UTC(2026, 0, 1, 0, 5) / 1000)).toEqual([
      { year: 2026, month: 1 },
      { year: 2026, month: 2 },
      { year: 2025, month: 12 },
    ]);
  });

  it("reads usernames and end time from the callback", () => {
    expect(readCallback(fixture("callback-live-184627853334.json"))).toEqual({
      usernames: ["Hikaru", "mind1mover"],
      endTime: 1790809438,
      type: "chess",
      finished: true,
    });
    expect(readCallback({ message: "Game is not found." })).toBeNull();
    expect(readCallback("<html>blocked</html>")).toBeNull();
  });
});

describe("fetchGameByUrl", () => {
  it("uses the callback for players + date, then takes the PGN from the official archive", async () => {
    routes["https://www.chess.com/callback/live/game/184627853334"] = ok("callback-live-184627853334.json");
    routes[`${PUB}/hikaru/games/2026/09`] = ok("archive-hikaru-2026-09.json");
    const g = await fetchGameByUrl("https://www.chess.com/game/live/184627853334");
    expect(g).toMatchObject({
      id: "184627853334",
      url: "https://www.chess.com/game/live/184627853334",
      white: "mind1mover",
      black: "Hikaru",
      whiteElo: 3054,
      blackElo: 3450,
      endTime: 1790809438,
      timeClass: "blitz",
    });
    expect(g.pgn).toContain('[Link "https://www.chess.com/game/live/184627853334"]');
    expect(calls).toEqual([
      "https://www.chess.com/callback/live/game/184627853334",
      `${PUB}/hikaru/games/2026/09`,
    ]);
  });

  it("handles daily games", async () => {
    routes["https://www.chess.com/callback/daily/game/1033338800"] = ok("callback-daily-1033338800.json");
    routes[`${PUB}/erik/games/2026/10`] = ok("archive-erik-2026-10.json");
    const g = await fetchGameByUrl("chess.com/game/daily/1033338800");
    expect(g).toMatchObject({ white: "Rooketamine", black: "erik", timeClass: "daily" });
  });

  it("falls back to the other player and neighbouring months", async () => {
    routes["https://www.chess.com/callback/live/game/184627853334"] = ok("callback-live-184627853334.json");
    routes[`${PUB}/mind1mover/games/2026/10`] = { status: 200, body: { games: [] } };
    routes[`${PUB}/mind1mover/games/2026/08`] = ok("archive-hikaru-2026-09.json");
    const g = await fetchGameByUrl("https://www.chess.com/game/live/184627853334");
    expect(g.black).toBe("Hikaru");
    expect(calls).toContain(`${PUB}/hikaru/games/2026/09`);
  });

  it("asks for a username when the callback fails", async () => {
    routes["https://www.chess.com/callback/live/game/184627853334"] = { status: 403, body: "blocked" };
    expect(await codeOf(fetchGameByUrl("https://www.chess.com/game/live/184627853334"))).toBe("need-username");
  });

  it("asks for a username when the callback returns junk", async () => {
    routes["https://www.chess.com/callback/live/game/184627853334"] = { status: 200, body: { foo: 1 } };
    expect(await codeOf(fetchGameByUrl("https://www.chess.com/game/live/184627853334"))).toBe("need-username");
  });

  it("with a username, scans the player's archives newest first when the callback fails", async () => {
    routes[`${PUB}/hikaru/games/archives`] = ok("archives-hikaru.json");
    routes[`${PUB}/hikaru/games/2026/10`] = ok("archive-hikaru-2026-10.json");
    routes[`${PUB}/hikaru/games/2026/09`] = ok("archive-hikaru-2026-09.json");
    const g = await fetchGameByUrl("https://www.chess.com/game/live/184627853334", "Hikaru");
    expect(g.white).toBe("mind1mover");
    expect(calls.slice(1)).toEqual([
      `${PUB}/hikaru/games/archives`,
      `${PUB}/hikaru/games/2026/10`,
      `${PUB}/hikaru/games/2026/09`,
    ]);
  });

  it("rejects variants", async () => {
    routes["https://www.chess.com/callback/daily/game/1036320138"] = {
      status: 200,
      body: { game: { type: "chess960", endTime: 1790978408, isFinished: true }, players: { top: { username: "erik" }, bottom: { username: "NorwegianViking82" } } },
    };
    expect(await codeOf(fetchGameByUrl("https://www.chess.com/game/daily/1036320138"))).toBe("unsupported-variant");
  });

  it("rejects variants found in the archive even without callback info", async () => {
    routes[`${PUB}/erik/games/archives`] = { status: 200, body: { archives: [`${PUB}/erik/games/2026/10`] } };
    routes[`${PUB}/erik/games/2026/10`] = ok("archive-erik-2026-10.json");
    expect(await codeOf(fetchGameByUrl("https://www.chess.com/game/daily/1036320138", "erik"))).toBe("unsupported-variant");
  });

  it("maps an unknown user to not-found", async () => {
    routes[`${PUB}/nonexistent_user_zzqq/games/archives`] = { status: 404, body: fixture("player-not-found.json") };
    expect(await codeOf(fetchGameByUrl("https://www.chess.com/game/live/1", "nonexistent_user_zzqq"))).toBe("not-found");
  });

  it("maps 429 to rate-limited", async () => {
    routes["https://www.chess.com/callback/live/game/184627853334"] = ok("callback-live-184627853334.json");
    routes[`${PUB}/hikaru/games/2026/09`] = { status: 429, body: {} };
    expect(await codeOf(fetchGameByUrl("https://www.chess.com/game/live/184627853334"))).toBe("rate-limited");
  });

  it("maps a 5xx to upstream", async () => {
    routes["https://www.chess.com/callback/live/game/184627853334"] = ok("callback-live-184627853334.json");
    routes[`${PUB}/hikaru/games/2026/09`] = { status: 503, body: {} };
    expect(await codeOf(fetchGameByUrl("https://www.chess.com/game/live/184627853334"))).toBe("upstream");
  });

  it("maps network errors on the archive to upstream", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    expect(await codeOf(fetchGameByUrl("https://www.chess.com/game/live/1", "hikaru"))).toBe("upstream");
  });

  it("is not-found when the game isn't in any archive", async () => {
    routes["https://www.chess.com/callback/live/game/184627853334"] = ok("callback-live-184627853334.json");
    expect(await codeOf(fetchGameByUrl("https://www.chess.com/game/live/184627853334"))).toBe("not-found");
  });

  it("rejects a non-chess.com url without any network call", async () => {
    expect(await codeOf(fetchGameByUrl("https://lichess.org/abc"))).toBe("not-found");
    expect(calls).toEqual([]);
  });
});

describe("listRecentGames", () => {
  it("merges the last two months newest first, skipping variants", async () => {
    routes[`${PUB}/hikaru/games/archives`] = ok("archives-hikaru.json");
    routes[`${PUB}/hikaru/games/2026/09`] = ok("archive-hikaru-2026-09.json");
    routes[`${PUB}/hikaru/games/2026/10`] = ok("archive-hikaru-2026-10.json");
    const games = await listRecentGames("Hikaru");
    expect(calls).not.toContain(`${PUB}/hikaru/games/2026/08`);
    expect(games.map((g) => g.id)).toEqual(["184727349064", "184727190848", "184627853334", "183193701751", "183193101523"]);
    expect(games[0]).toMatchObject({ result: "0-1", timeClass: expect.any(String), url: "https://www.chess.com/game/live/184727349064" });
    expect(games[1].result).toBe("1-0");
    expect(games.find((g) => g.id === "184627853334")).toMatchObject({
      white: "mind1mover",
      black: "Hikaru",
      whiteElo: 3054,
      blackElo: 3450,
      result: "0-1",
      endTime: 1790809438,
    });
  });

  it("respects the limit", async () => {
    routes[`${PUB}/hikaru/games/archives`] = ok("archives-hikaru.json");
    routes[`${PUB}/hikaru/games/2026/09`] = ok("archive-hikaru-2026-09.json");
    routes[`${PUB}/hikaru/games/2026/10`] = ok("archive-hikaru-2026-10.json");
    expect(await listRecentGames("hikaru", 2)).toHaveLength(2);
  });

  it("maps an unknown user to not-found", async () => {
    routes[`${PUB}/nonexistent_user_zzqq/games/archives`] = { status: 404, body: fixture("player-not-found.json") };
    expect(await codeOf(listRecentGames("nonexistent_user_zzqq"))).toBe("not-found");
  });

  it("returns an empty list for a user without games", async () => {
    routes[`${PUB}/newbie/games/archives`] = { status: 200, body: { archives: [] } };
    expect(await listRecentGames("newbie")).toEqual([]);
  });
});
