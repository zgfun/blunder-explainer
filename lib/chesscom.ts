export type ChessComErrorCode = "not-found" | "need-username" | "rate-limited" | "upstream" | "unsupported-variant";

export class ChessComError extends Error {
  readonly code: ChessComErrorCode;
  constructor(code: ChessComErrorCode, message: string) {
    super(message);
    this.name = "ChessComError";
    this.code = code;
  }
}

export const CHESSCOM_HTTP_STATUS: Record<ChessComErrorCode, number> = {
  "not-found": 404,
  "need-username": 422,
  "unsupported-variant": 422,
  "rate-limited": 429,
  upstream: 502,
};

export type GameKind = "live" | "daily";

export type ChessComGame = {
  id: string;
  url: string;
  pgn: string;
  white: string;
  black: string;
  whiteElo?: number;
  blackElo?: number;
  endTime: number;
  timeClass: string;
};

export type GameResult = "1-0" | "0-1" | "1/2-1/2";

export type GameSummary = {
  url: string;
  id: string;
  white: string;
  black: string;
  whiteElo: number;
  blackElo: number;
  result: GameResult;
  timeClass: string;
  endTime: number;
};

type ArchivePlayer = { username: string; rating: number; result: string };
type ArchiveGame = {
  url: string;
  pgn?: string;
  time_class: string;
  rules: string;
  end_time: number;
  white: ArchivePlayer;
  black: ArchivePlayer;
};

export const USERNAME_RE = /^[A-Za-z0-9_-]{3,25}$/;

const API = "https://api.chess.com/pub";
const TIMEOUT_MS = 10_000;
// Archive scan depth when the unofficial callback is unavailable and we only have a username.
const MAX_MONTHS_WITHOUT_CALLBACK = 12;

const GAME_URL_RE =
  /^(?:https?:\/\/)?(?:(?:www|m)\.)?chess\.com\/(?:analysis\/)?(?:game\/(live|daily)|(live|daily)\/game|game)\/(\d{1,15})\/?(?:[?#].*)?$/i;

export function parseGameUrl(input: string): { kind: GameKind; id: string } | null {
  const m = GAME_URL_RE.exec(input.trim());
  if (!m) return null;
  // chess.com's newer short form "/game/{id}" is a live game.
  const kind = (m[1] ?? m[2] ?? "live").toLowerCase() as GameKind;
  return { kind, id: m[3] };
}

function userAgent(): string {
  return `BlunderExplainer/1.0 (+contact: ${process.env.CHESSCOM_CONTACT ?? "unknown"})`;
}

type FetchResult = { ok: true; data: unknown } | { ok: false; status: number };

async function getJson(url: string): Promise<FetchResult> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": userAgent(), Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    return { ok: false, status: 0 };
  }
  if (!res.ok) return { ok: false, status: res.status };
  try {
    return { ok: true, data: await res.json() };
  } catch {
    return { ok: false, status: 0 };
  }
}

function upstreamError(status: number, what: string): ChessComError {
  if (status === 429) return new ChessComError("rate-limited", "chess.com is rate-limiting us. Try again in a minute.");
  if (status === 404 || status === 410) return new ChessComError("not-found", `${what} was not found on chess.com.`);
  return new ChessComError("upstream", "chess.com did not respond as expected. Try again later.");
}

async function fetchArchiveList(username: string): Promise<string[]> {
  const r = await getJson(`${API}/player/${encodeURIComponent(username.toLowerCase())}/games/archives`);
  if (!r.ok) throw upstreamError(r.status, `User "${username}"`);
  const archives = (r.data as { archives?: unknown }).archives;
  return Array.isArray(archives) ? archives.filter((a): a is string => typeof a === "string") : [];
}

async function fetchArchive(url: string): Promise<ArchiveGame[]> {
  const r = await getJson(url);
  if (!r.ok) throw upstreamError(r.status, "That month's game archive");
  const games = (r.data as { games?: unknown }).games;
  return Array.isArray(games) ? (games as ArchiveGame[]) : [];
}

function archiveUrl(username: string, year: number, month: number): string {
  return `${API}/player/${encodeURIComponent(username.toLowerCase())}/games/${year}/${String(month).padStart(2, "0")}`;
}

/** Month of endTime first, then its neighbours in case the archive month is not the UTC end month. */
export function candidateMonths(endTime: number): { year: number; month: number }[] {
  const d = new Date(endTime * 1000);
  return [0, 1, -1].map((delta) => {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + delta, 1));
    return { year: x.getUTCFullYear(), month: x.getUTCMonth() + 1 };
  });
}

export function findGameInArchive(games: ArchiveGame[], kind: GameKind, id: string): ArchiveGame | undefined {
  return games.find((g) => {
    const p = typeof g.url === "string" ? parseGameUrl(g.url) : null;
    return p !== null && p.kind === kind && p.id === id;
  });
}

type CallbackInfo = { usernames: string[]; endTime: number | null; type: string | null; finished: boolean };

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * The unofficial callback is used only to learn who played and when the game ended;
 * the PGN always comes from the official monthly archive.
 */
export function readCallback(data: unknown): CallbackInfo | null {
  if (!data || typeof data !== "object") return null;
  const { game, players } = data as {
    game?: { endTime?: unknown; type?: unknown; isFinished?: unknown; pgnHeaders?: Record<string, unknown> };
    players?: { top?: { username?: unknown }; bottom?: { username?: unknown } };
  };
  if (!game || typeof game !== "object") return null;
  const names = [
    str(players?.top?.username),
    str(players?.bottom?.username),
    str(game.pgnHeaders?.White),
    str(game.pgnHeaders?.Black),
  ].filter((n): n is string => n !== null && USERNAME_RE.test(n));
  const usernames = [...new Map(names.map((n) => [n.toLowerCase(), n])).values()];
  if (usernames.length === 0) return null;
  return {
    usernames,
    endTime: typeof game.endTime === "number" && game.endTime > 0 ? game.endTime : null,
    type: str(game.type),
    finished: game.isFinished !== false,
  };
}

async function fetchCallback(kind: GameKind, id: string): Promise<CallbackInfo | null> {
  const r = await getJson(`https://www.chess.com/callback/${kind}/game/${id}`);
  return r.ok ? readCallback(r.data) : null;
}

function toGame(g: ArchiveGame, id: string): ChessComGame {
  if (g.rules !== "chess") {
    throw new ChessComError("unsupported-variant", `This is a ${g.rules} game; only standard chess is supported.`);
  }
  if (!g.pgn) throw new ChessComError("not-found", "chess.com has no PGN for this game.");
  return {
    id,
    url: g.url,
    pgn: g.pgn,
    white: g.white.username,
    black: g.black.username,
    whiteElo: typeof g.white.rating === "number" ? g.white.rating : undefined,
    blackElo: typeof g.black.rating === "number" ? g.black.rating : undefined,
    endTime: g.end_time,
    timeClass: g.time_class,
  };
}

async function searchMonths(
  username: string,
  months: { year: number; month: number }[],
  kind: GameKind,
  id: string,
): Promise<ArchiveGame | undefined> {
  for (const { year, month } of months) {
    let games: ArchiveGame[];
    try {
      games = await fetchArchive(archiveUrl(username, year, month));
    } catch (e) {
      // A month the player has no archive for simply 404s; keep looking.
      if (e instanceof ChessComError && e.code === "not-found") continue;
      throw e;
    }
    const hit = findGameInArchive(games, kind, id);
    if (hit) return hit;
  }
  return undefined;
}

export async function fetchGameByUrl(input: string, username?: string): Promise<ChessComGame> {
  const parsed = parseGameUrl(input);
  if (!parsed) throw new ChessComError("not-found", "That doesn't look like a chess.com game link.");
  const { kind, id } = parsed;
  if (username !== undefined && !USERNAME_RE.test(username)) {
    throw new ChessComError("not-found", "That doesn't look like a chess.com username.");
  }

  const info = await fetchCallback(kind, id);

  if (info) {
    if (info.type && info.type !== "chess") {
      throw new ChessComError("unsupported-variant", `This is a ${info.type} game; only standard chess is supported.`);
    }
    if (!info.finished || info.endTime === null) {
      throw new ChessComError("not-found", "This game hasn't finished yet, so chess.com hasn't archived it.");
    }
    const months = candidateMonths(info.endTime);
    const order = username
      ? [username, ...info.usernames.filter((u) => u.toLowerCase() !== username.toLowerCase())]
      : info.usernames;
    for (const u of order) {
      const hit = await searchMonths(u, months, kind, id);
      if (hit) return toGame(hit, id);
    }
    throw new ChessComError("not-found", "Couldn't find this game in the players' chess.com archives.");
  }

  if (!username) {
    throw new ChessComError("need-username", "We couldn't look this game up directly. Enter one of the players' usernames.");
  }
  const archives = await fetchArchiveList(username);
  for (const url of archives.slice(-MAX_MONTHS_WITHOUT_CALLBACK).reverse()) {
    const hit = findGameInArchive(await fetchArchive(url), kind, id);
    if (hit) return toGame(hit, id);
  }
  throw new ChessComError("not-found", `Couldn't find this game in ${username}'s recent chess.com games.`);
}

export function resultOf(g: Pick<ArchiveGame, "white" | "black">): GameResult {
  if (g.white.result === "win") return "1-0";
  if (g.black.result === "win") return "0-1";
  return "1/2-1/2";
}

export async function listRecentGames(username: string, limit = 20): Promise<GameSummary[]> {
  if (!USERNAME_RE.test(username)) throw new ChessComError("not-found", "That doesn't look like a chess.com username.");
  const archives = await fetchArchiveList(username);
  const months = await Promise.all(archives.slice(-2).map(fetchArchive));
  return months
    .flat()
    .filter((g) => g.rules === "chess")
    .sort((a, b) => b.end_time - a.end_time)
    .slice(0, limit)
    .flatMap((g) => {
      const p = parseGameUrl(g.url);
      if (!p) return [];
      return [
        {
          url: g.url,
          id: p.id,
          white: g.white.username,
          black: g.black.username,
          whiteElo: g.white.rating,
          blackElo: g.black.rating,
          result: resultOf(g),
          timeClass: g.time_class,
          endTime: g.end_time,
        },
      ];
    });
}
