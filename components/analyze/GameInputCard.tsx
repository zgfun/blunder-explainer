"use client";

import { Alert, Badge, Button, Card, chakra, Field, Flex, HStack, Input, Stack, Tabs, Text, Textarea } from "@chakra-ui/react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Side } from "@/lib/chess/types";
import { sideOfUser, type GameInput } from "./format";

type GameResponse = GameInput & { id: string; source: string };
type GameSummary = {
  url: string;
  id: string;
  white: string;
  black: string;
  whiteElo: number;
  blackElo: number;
  result: "1-0" | "0-1" | "1/2-1/2";
  timeClass: string;
  endTime: number;
};
type ApiError = { error?: string; message?: string };

export type Loaded = { game: GameInput; defaultSide?: Side; query?: { url: string; username?: string } };

const USERNAME_RE = /^[A-Za-z0-9_-]{3,25}$/;

async function readJson<T>(res: Response): Promise<T & ApiError> {
  return (await res.json().catch(() => ({}))) as T & ApiError;
}

function friendly(status: number, data: ApiError, fallback: string): string {
  if (status === 429) return "chess.com is rate-limiting us right now. Wait a minute and try again.";
  if (data.message) return data.message;
  if (status === 404) return "Not found on chess.com.";
  return fallback;
}

function toInput(g: GameResponse): GameInput {
  return {
    id: g.id,
    url: g.url,
    pgn: g.pgn,
    white: g.white,
    black: g.black,
    whiteElo: g.whiteElo,
    blackElo: g.blackElo,
    timeClass: g.timeClass,
  };
}

function ago(endTime: number): string {
  const s = Date.now() / 1000 - endTime;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  const d = Math.round(s / 86400);
  return d === 1 ? "yesterday" : `${d}d ago`;
}

export function GameInputCard({ onLoaded, initial }: { onLoaded: (l: Loaded) => void; initial?: { url?: string; username?: string } }) {
  const [tab, setTab] = useState("url");
  return (
    <Card.Root variant="elevated" borderRadius="xl" boxShadow="lg" borderWidth="1px" borderColor="border.muted">
      <Card.Body p={{ base: "4", md: "6" }}>
        <Tabs.Root value={tab} onValueChange={(e) => setTab(e.value)} variant="subtle" size="sm" fitted lazyMount>
          <Tabs.List mb="4" bg="bg.muted" p="1" borderRadius="lg">
            <Tabs.Trigger value="url">Game URL</Tabs.Trigger>
            <Tabs.Trigger value="username">Username</Tabs.Trigger>
            <Tabs.Trigger value="pgn">PGN</Tabs.Trigger>
          </Tabs.List>
          <Tabs.Content value="url" pt="0">
            <UrlForm onLoaded={onLoaded} initial={initial} />
          </Tabs.Content>
          <Tabs.Content value="username" pt="0">
            <UsernameForm onLoaded={onLoaded} />
          </Tabs.Content>
          <Tabs.Content value="pgn" pt="0">
            <PgnForm onLoaded={onLoaded} />
          </Tabs.Content>
        </Tabs.Root>
      </Card.Body>
    </Card.Root>
  );
}

function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Alert.Root status="error" size="sm" borderRadius="md">
      <Alert.Indicator />
      <Alert.Description>{message}</Alert.Description>
    </Alert.Root>
  );
}

function UrlForm({ onLoaded, initial }: { onLoaded: (l: Loaded) => void; initial?: { url?: string; username?: string } }) {
  const [url, setUrl] = useState(initial?.url ?? "");
  const [username, setUsername] = useState(initial?.username ?? "");
  const [needUsername, setNeedUsername] = useState(!!initial?.username);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoRan = useRef(false);

  const load = async (u: string, name: string) => {
    if (!u.trim()) {
      setError("Paste a chess.com game link first.");
      return;
    }
    if (name && !USERNAME_RE.test(name)) {
      setError("That doesn't look like a chess.com username.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ url: u.trim() });
      if (name) qs.set("username", name);
      const res = await fetch(`/api/game?${qs}`);
      const data = await readJson<GameResponse>(res);
      if (res.status === 422 && data.error === "need-username") {
        setNeedUsername(true);
        setError(name ? "Couldn't find that game in this player's archive. Check the username." : null);
        return;
      }
      if (!res.ok) {
        setError(friendly(res.status, data, "Couldn't load that game."));
        return;
      }
      onLoaded({
        game: toInput(data),
        defaultSide: sideOfUser(name || undefined, data.white, data.black),
        query: { url: u.trim(), username: name || undefined },
      });
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (autoRan.current || !initial?.url) return;
    autoRan.current = true;
    void load(initial.url, initial.username ?? "");
    // Runs once for a shared ?url= link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void load(url, needUsername ? username.trim() : "");
  };

  return (
    <form onSubmit={submit}>
      <Stack gap="3">
        <Field.Root>
          <Field.Label>chess.com game link</Field.Label>
          <Flex gap="2" direction={{ base: "column", sm: "row" }}>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.chess.com/game/live/123456789"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              size="lg"
            />
            <Button type="submit" colorPalette="green" size="lg" loading={busy} loadingText="Loading" flexShrink={0}>
              Analyse
            </Button>
          </Flex>
          <Field.HelperText>Live and daily games, standard chess only.</Field.HelperText>
        </Field.Root>
        {needUsername && (
          <Field.Root>
            <Field.Label>Username of either player</Field.Label>
            <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. hikaru" autoComplete="off" spellCheck={false} />
            <Field.HelperText>chess.com didn&apos;t tell us who played this game. Enter one player and we&apos;ll find it in their archive.</Field.HelperText>
          </Field.Root>
        )}
        <ErrorNote message={error} />
      </Stack>
    </form>
  );
}

function UsernameForm({ onLoaded }: { onLoaded: (l: Loaded) => void }) {
  const [username, setUsername] = useState("");
  const [searched, setSearched] = useState("");
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const search = async (e: FormEvent) => {
    e.preventDefault();
    const name = username.trim();
    if (!USERNAME_RE.test(name)) {
      setError("Usernames are 3–25 letters, numbers, - or _.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/games?${new URLSearchParams({ username: name })}`);
      const data = await readJson<{ games: GameSummary[] }>(res);
      if (!res.ok) {
        setGames(null);
        setError(res.status === 404 ? `No chess.com player called "${name}".` : friendly(res.status, data, "Couldn't load games."));
        return;
      }
      setGames(data.games ?? []);
      setSearched(name);
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const open = async (g: GameSummary) => {
    setOpening(g.url);
    setError(null);
    try {
      const res = await fetch(`/api/game?${new URLSearchParams({ url: g.url, username: searched })}`);
      const data = await readJson<GameResponse>(res);
      if (!res.ok) {
        setError(friendly(res.status, data, "Couldn't load that game."));
        return;
      }
      onLoaded({
        game: { ...toInput(data), url: data.url ?? g.url, timeClass: data.timeClass ?? g.timeClass },
        defaultSide: sideOfUser(searched, data.white, data.black),
        query: { url: g.url, username: searched },
      });
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setOpening(null);
    }
  };

  return (
    <Stack gap="3">
      <form onSubmit={search}>
        <Field.Root>
          <Field.Label>chess.com username</Field.Label>
          <Flex gap="2" direction={{ base: "column", sm: "row" }}>
            <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. hikaru" autoComplete="off" spellCheck={false} size="lg" />
            <Button type="submit" colorPalette="green" size="lg" loading={busy} loadingText="Searching" flexShrink={0}>
              Find games
            </Button>
          </Flex>
        </Field.Root>
      </form>
      <ErrorNote message={error} />
      {games && games.length === 0 && (
        <Text fontSize="sm" color="fg.muted">
          No standard games in the last two months.
        </Text>
      )}
      {games && games.length > 0 && (
        <Stack gap="1.5" maxH="360px" overflowY="auto" pr="1" mx="-1" px="1">
          {games.map((g) => {
            const me = sideOfUser(searched, g.white, g.black);
            const won = (me === "white" && g.result === "1-0") || (me === "black" && g.result === "0-1");
            const lost = (me === "white" && g.result === "0-1") || (me === "black" && g.result === "1-0");
            return (
              <chakra.button
                key={g.url}
                type="button"
                textAlign="left"
                w="100%"
                borderWidth="1px"
                borderColor="border"
                borderRadius="md"
                px="3"
                py="2.5"
                _hover={{ bg: "bg.muted", borderColor: "border.emphasized" }}
                transition="background 0.15s"
                onClick={() => void open(g)}
                aria-busy={opening === g.url}
                opacity={opening && opening !== g.url ? 0.5 : 1}
                disabled={!!opening}
              >
                <Flex justify="space-between" align="center" gap="3">
                  <Stack gap="0.5" minW="0" fontSize="sm">
                    <Text truncate>
                      <Text as="span" fontWeight={me === "white" ? "semibold" : "normal"}>
                        {g.white}
                      </Text>{" "}
                      <Text as="span" color="fg.muted">
                        ({g.whiteElo})
                      </Text>{" "}
                      vs{" "}
                      <Text as="span" fontWeight={me === "black" ? "semibold" : "normal"}>
                        {g.black}
                      </Text>{" "}
                      <Text as="span" color="fg.muted">
                        ({g.blackElo})
                      </Text>
                    </Text>
                    <Text fontSize="xs" color="fg.muted" textTransform="capitalize">
                      {g.timeClass} · {ago(g.endTime)}
                    </Text>
                  </Stack>
                  <HStack gap="2" flexShrink={0}>
                    <Badge colorPalette={won ? "green" : lost ? "red" : "gray"} variant="subtle" fontFamily="mono">
                      {g.result === "1/2-1/2" ? "½-½" : g.result}
                    </Badge>
                    <Text fontSize="xs" color="fg.muted">
                      {opening === g.url ? "Loading…" : "Analyse →"}
                    </Text>
                  </HStack>
                </Flex>
              </chakra.button>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}

function PgnForm({ onLoaded }: { onLoaded: (l: Loaded) => void }) {
  const [pgn, setPgn] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!pgn.trim()) {
      setError("Paste a PGN first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/game", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pgn }),
      });
      const data = await readJson<GameResponse>(res);
      if (!res.ok) {
        setError(friendly(res.status, data, "That PGN couldn't be read."));
        return;
      }
      onLoaded({ game: toInput(data) });
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <Stack gap="3">
        <Field.Root>
          <Field.Label>PGN</Field.Label>
          <Textarea
            value={pgn}
            onChange={(e) => setPgn(e.target.value)}
            placeholder={'[Event "Casual game"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bc4 Nd4 4. Nxe5 Qg5 ...'}
            rows={7}
            fontFamily="mono"
            fontSize="sm"
            spellCheck={false}
          />
        </Field.Root>
        <ErrorNote message={error} />
        <Button type="submit" colorPalette="green" loading={busy} loadingText="Reading" alignSelf={{ base: "stretch", sm: "flex-end" }}>
          Analyse PGN
        </Button>
      </Stack>
    </form>
  );
}
