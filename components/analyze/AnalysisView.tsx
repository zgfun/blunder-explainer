"use client";

import { Alert, Badge, Box, Button, Card, Flex, HStack, Link, Progress, SegmentGroup, Stack, Text } from "@chakra-ui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { pickBlunders, scoreToWhiteCp, toPawnsClamped } from "@/lib/chess/analysis";
import { parsePgn } from "@/lib/chess/pgn";
import type { EngineLine, ParsedGame, Side } from "@/lib/chess/types";
import { Engine } from "@/lib/engine/engine";
import { BlunderCard } from "./BlunderCard";
import { EvalGraph, type GraphMarker } from "./EvalGraph";
import { LEVELS, sideFromFen, type GameInput, type Level } from "./format";

const ENGINE_DEPTH = 14;
const MARKER_COLORS = ["#e5484d", "#f76b15", "#ffb224"];

type Phase =
  | { kind: "ready"; lines: EngineLine[] }
  | { kind: "running"; done: number; total: number }
  | { kind: "cancelled" }
  | { kind: "failed"; message: string };

function parseSafe(pgn: string): { game: ParsedGame } | { error: string } {
  try {
    const game = parsePgn(pgn);
    if (game.plies.length === 0) return { error: "This game has no moves to analyse." };
    return { game };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not read this PGN." };
  }
}

export function AnalysisView({
  game,
  lines: precomputed,
  defaultSide,
  note,
}: {
  game: GameInput;
  lines?: EngineLine[];
  defaultSide?: Side;
  note?: string;
}) {
  const parsed = useMemo(() => parseSafe(game.pgn), [game.pgn]);
  const parsedGame = "game" in parsed ? parsed.game : null;
  const fens = useMemo(
    () => (parsedGame ? [...parsedGame.plies.map((p) => p.fenBefore), parsedGame.plies[parsedGame.plies.length - 1].fenAfter] : []),
    [parsedGame],
  );
  const hasPrecomputed = !!precomputed && precomputed.length === fens.length;

  const [phase, setPhase] = useState<Phase>(() =>
    hasPrecomputed ? { kind: "ready", lines: precomputed } : { kind: "running", done: 0, total: fens.length },
  );
  const [run, setRun] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const [side, setSide] = useState<Side | "both">(defaultSide ?? "both");
  const [level, setLevel] = useState<Level>(1600);

  useEffect(() => {
    if (hasPrecomputed || !parsedGame || fens.length === 0) return;
    const ctrl = new AbortController();
    const engine = new Engine();
    abortRef.current = ctrl;
    engine
      .analyseAll(fens, {
        depth: ENGINE_DEPTH,
        signal: ctrl.signal,
        onProgress: (done, total) => {
          if (!ctrl.signal.aborted) setPhase({ kind: "running", done, total });
        },
      })
      .then((lines) => {
        if (!ctrl.signal.aborted) setPhase({ kind: "ready", lines });
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        console.error(err);
        setPhase({ kind: "failed", message: "Stockfish could not start in this browser. Try reloading, or use a recent Chrome, Firefox or Safari." });
      })
      .finally(() => engine.terminate());
    return () => {
      ctrl.abort();
      engine.terminate();
    };
  }, [hasPrecomputed, parsedGame, fens, run]);

  const restart = () => {
    setPhase({ kind: "running", done: 0, total: fens.length });
    setRun((r) => r + 1);
  };

  const lines = phase.kind === "ready" ? phase.lines : null;

  const blunders = useMemo(
    () => (parsedGame && lines ? pickBlunders(parsedGame, lines, { side, count: 3 }) : []),
    [parsedGame, lines, side],
  );

  const graph = useMemo(() => {
    if (!parsedGame || !lines) return null;
    const evals = lines.map((l, i) => toPawnsClamped(scoreToWhiteCp(l.score, sideFromFen(fens[i]))));
    const moveLabels = ["", ...parsedGame.plies.map((p) => `${p.fenBefore.split(" ")[5] ?? ""}${p.side === "white" ? "." : "..."} ${p.san}`)];
    return { evals, moveLabels };
  }, [parsedGame, lines, fens]);

  const markers: GraphMarker[] = blunders.map((b, i) => ({
    index: b.ply + 1,
    color: MARKER_COLORS[i] ?? MARKER_COLORS[2],
    label: `#${i + 1} ${b.san}`,
    targetId: `blunder-${i + 1}`,
  }));

  if (!parsedGame) {
    return (
      <Alert.Root status="error" borderRadius="lg">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>Could not read this game</Alert.Title>
          <Alert.Description>{"error" in parsed ? parsed.error : ""}</Alert.Description>
        </Alert.Content>
      </Alert.Root>
    );
  }

  const result = parsedGame.headers.Result && parsedGame.headers.Result !== "*" ? parsedGame.headers.Result : null;
  const moves = Math.ceil(parsedGame.plies.length / 2);

  return (
    <Stack gap="6">
      <Card.Root variant="outline">
        <Card.Body gap="4">
          <Flex justify="space-between" align={{ base: "flex-start", md: "center" }} gap="3" direction={{ base: "column", md: "row" }}>
            <Stack gap="1">
              <HStack gap="2" wrap="wrap" fontSize={{ base: "md", md: "lg" }} fontWeight="semibold">
                <PlayerChip name={game.white} elo={game.whiteElo} color="white" />
                <Text color="fg.subtle" fontWeight="normal">
                  vs
                </Text>
                <PlayerChip name={game.black} elo={game.blackElo} color="black" />
              </HStack>
              <HStack gap="2" fontSize="sm" color="fg.muted" wrap="wrap">
                {result && <Badge variant="outline">{result}</Badge>}
                <Text>{moves} moves</Text>
                {game.timeClass && <Text textTransform="capitalize">· {game.timeClass}</Text>}
                {game.url && (
                  <Link href={game.url} target="_blank" rel="noreferrer" colorPalette="green" color="colorPalette.fg">
                    · view on chess.com ↗
                  </Link>
                )}
              </HStack>
              {note && (
                <Text fontSize="sm" color="fg.muted">
                  {note}
                </Text>
              )}
            </Stack>
            {lines && (
              <Stack gap="3" align={{ base: "stretch", md: "flex-end" }}>
                <ControlRow label="Side">
                  <SegmentGroup.Root size="sm" value={side} onValueChange={(e) => e.value && setSide(e.value as Side | "both")}>
                    <SegmentGroup.Indicator />
                    <SegmentGroup.Items
                      items={[
                        { value: "white", label: "White" },
                        { value: "black", label: "Black" },
                        { value: "both", label: "Both" },
                      ]}
                    />
                  </SegmentGroup.Root>
                </ControlRow>
                <ControlRow label="Explain like I'm">
                  <SegmentGroup.Root size="sm" value={String(level)} onValueChange={(e) => e.value && setLevel(Number(e.value) as Level)}>
                    <SegmentGroup.Indicator />
                    <SegmentGroup.Items items={LEVELS.map((l) => ({ value: String(l), label: String(l) }))} />
                  </SegmentGroup.Root>
                </ControlRow>
              </Stack>
            )}
          </Flex>

          {phase.kind === "running" && (
            <Stack gap="2">
              <Flex justify="space-between" align="center" gap="3">
                <Text fontSize="sm" color="fg.muted" aria-live="polite">
                  Analysing move {Math.min(phase.done + 1, phase.total)} / {phase.total} · Stockfish depth {ENGINE_DEPTH}, running in your
                  browser
                </Text>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => {
                    abortRef.current?.abort();
                    setPhase({ kind: "cancelled" });
                  }}
                >
                  Cancel
                </Button>
              </Flex>
              <Progress.Root value={phase.total ? (phase.done / phase.total) * 100 : 0} colorPalette="green" size="sm" striped animated>
                <Progress.Track borderRadius="full">
                  <Progress.Range />
                </Progress.Track>
              </Progress.Root>
            </Stack>
          )}

          {phase.kind === "cancelled" && (
            <Flex justify="space-between" align="center" gap="3">
              <Text fontSize="sm" color="fg.muted">
                Analysis cancelled.
              </Text>
              <Button size="xs" colorPalette="green" onClick={restart}>
                Analyse again
              </Button>
            </Flex>
          )}

          {phase.kind === "failed" && (
            <Alert.Root status="error" size="sm">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Description>{phase.message}</Alert.Description>
              </Alert.Content>
              <Button size="xs" variant="outline" onClick={restart}>
                Retry
              </Button>
            </Alert.Root>
          )}

          {graph && <EvalGraph evals={graph.evals} moveLabels={graph.moveLabels} markers={markers} />}
        </Card.Body>
      </Card.Root>

      {lines && blunders.length === 0 && (
        <Card.Root variant="subtle">
          <Card.Body>
            <Text fontWeight="semibold">No big mistakes found{side !== "both" ? ` for ${side === "white" ? "White" : "Black"}` : ""}.</Text>
            <Text color="fg.muted" fontSize="sm">
              No move lost a full pawn or more by Stockfish&apos;s count. Try the other side, or a different game.
            </Text>
          </Card.Body>
        </Card.Root>
      )}

      {blunders.map((b, i) => (
        <BlunderCard key={`${b.ply}-${b.uci}`} id={`blunder-${i + 1}`} blunder={b} rank={i + 1} level={level} />
      ))}
    </Stack>
  );
}

function ControlRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Flex align="center" gap="3" justify={{ base: "space-between", md: "flex-end" }}>
      <Text fontSize="xs" color="fg.muted" whiteSpace="nowrap">
        {label}
      </Text>
      {children}
    </Flex>
  );
}

function PlayerChip({ name, elo, color }: { name: string; elo?: number; color: Side }) {
  return (
    <HStack gap="1.5">
      <Box
        boxSize="3"
        borderRadius="sm"
        borderWidth="1px"
        borderColor="border.emphasized"
        bg={color === "white" ? "#f0efe9" : "#262624"}
        flexShrink={0}
      />
      <Text>{name || (color === "white" ? "White" : "Black")}</Text>
      {elo ? (
        <Text as="span" color="fg.muted" fontWeight="normal" fontSize="sm">
          ({elo})
        </Text>
      ) : null}
    </HStack>
  );
}
