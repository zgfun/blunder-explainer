"use client";

import { Badge, Box, Button, Card, Flex, HStack, Skeleton, Stack, Text, Wrap } from "@chakra-ui/react";
import { Chess } from "chess.js";
import { useMemo, useState, type CSSProperties } from "react";
import type { Blunder } from "@/lib/chess/types";
import { ARROW_BEST, ARROW_PLAYED, AnnotatedBoard, tint } from "./AnnotatedBoard";
import { formatLoss, formatPawns, moveLabel, severity, type Level } from "./format";
import { useExplanation } from "./useExplanation";

type View = { kind: "position" } | { kind: "played" } | { kind: "pv"; index: number };

const LAST_MOVE = "#f5c542";

function squares(uci: string) {
  return { from: uci.slice(0, 2), to: uci.slice(2, 4) };
}

function pvPositions(fen: string, pvUci: string[]): string[] {
  const chess = new Chess(fen);
  const out: string[] = [];
  for (const uci of pvUci) {
    try {
      chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    } catch {
      break;
    }
    out.push(chess.fen());
  }
  return out;
}

export function BlunderCard({ blunder: b, rank, level, id }: { blunder: Blunder; rank: number; level: Level; id?: string }) {
  const [view, setView] = useState<View>({ kind: "position" });
  const sev = severity(b.cpLoss);
  const label = moveLabel(b);
  const pvSan = b.pvSan.length ? b.pvSan : b.bestSan ? [b.bestSan] : [];
  const pvFens = useMemo(() => pvPositions(b.fenBefore, b.pvUci.slice(0, pvSan.length)), [b.fenBefore, b.pvUci, pvSan.length]);
  const explanation = useExplanation(b, level);
  const played = squares(b.uci);
  const best = b.bestUci ? squares(b.bestUci) : null;

  let fen = b.fenBefore;
  let arrows = [
    { ...played, color: ARROW_PLAYED },
    ...(best ? [{ ...best, color: ARROW_BEST }] : []),
  ];
  let highlights: Record<string, CSSProperties> = {};
  if (view.kind === "played") {
    fen = b.fenAfter;
    arrows = [];
    highlights = { [played.from]: tint(ARROW_PLAYED, 0.35), [played.to]: tint(ARROW_PLAYED, 0.5) };
  } else if (view.kind === "pv" && pvFens[view.index]) {
    fen = pvFens[view.index];
    const last = squares(b.pvUci[view.index]);
    highlights = { [last.from]: tint(LAST_MOVE, 0.3), [last.to]: tint(LAST_MOVE, 0.45) };
    const next = b.pvUci[view.index + 1];
    arrows = next && view.index + 1 < pvFens.length ? [{ ...squares(next), color: ARROW_BEST }] : [];
  }

  const mover = b.side === "white" ? "White" : "Black";

  return (
    <Card.Root id={id} variant="outline" overflow="hidden" scrollMarginTop="24">
      <Card.Header pb="0">
        <Flex justify="space-between" align="flex-start" gap="3" wrap="wrap">
          <HStack gap="3" align="center">
            <Flex
              boxSize="9"
              borderRadius="full"
              bg={`${sev.palette}.subtle`}
              color={`${sev.palette}.fg`}
              align="center"
              justify="center"
              fontWeight="bold"
              fontSize="sm"
              flexShrink={0}
            >
              #{rank}
            </Flex>
            <Box>
              <Text fontFamily="mono" fontSize={{ base: "xl", md: "2xl" }} fontWeight="semibold" lineHeight="1.2">
                {label}
              </Text>
              <Text fontSize="sm" color="fg.muted">
                {mover} to move · eval {formatPawns(b.evalBeforePawns)} → {formatPawns(b.evalAfterPawns)}
              </Text>
            </Box>
          </HStack>
          <HStack gap="2">
            {explanation.theme && (
              <Badge colorPalette="purple" variant="subtle" size="md" textTransform="capitalize">
                {explanation.theme}
              </Badge>
            )}
            <Badge colorPalette={sev.palette} variant="solid" size="md">
              {sev.label} {formatLoss(b.cpLoss)}
            </Badge>
          </HStack>
        </Flex>
      </Card.Header>
      <Card.Body>
        <Flex direction={{ base: "column", md: "row" }} gap={{ base: "5", md: "6" }}>
          <Stack w={{ base: "100%", md: "320px", lg: "360px" }} flexShrink={0} gap="2" mx={{ base: "auto", md: "0" }} maxW="420px">
            <AnnotatedBoard
              fen={fen}
              orientation={b.side}
              arrows={arrows}
              highlights={highlights}
              label={`Position before ${label}. Red arrow: the move played. Green arrow: the engine's best move.`}
            />
            <HStack gap="4" fontSize="xs" color="fg.muted" justify="center">
              <HStack gap="1.5">
                <Box w="3" h="1" borderRadius="full" bg={ARROW_PLAYED} />
                <Text>played {b.san}</Text>
              </HStack>
              {b.bestSan && (
                <HStack gap="1.5">
                  <Box w="3" h="1" borderRadius="full" bg={ARROW_BEST} />
                  <Text>best {b.bestSan}</Text>
                </HStack>
              )}
            </HStack>
          </Stack>

          <Stack gap="4" flex="1" minW="0">
            <Box>
              <Text fontSize="sm" color="fg.muted" mb="1.5">
                {b.bestSan ? (
                  <>
                    Best was{" "}
                    <Text as="span" fontFamily="mono" fontWeight="semibold" color="fg">
                      {b.bestSan}
                    </Text>
                    {pvSan.length > 1 ? ", line (tap to step through):" : ""}
                  </>
                ) : (
                  "No engine line for this position."
                )}
              </Text>
              <Wrap gap="1.5">
                <Button size="xs" variant={view.kind === "position" ? "solid" : "outline"} onClick={() => setView({ kind: "position" })}>
                  Position
                </Button>
                <Button
                  size="xs"
                  variant={view.kind === "played" ? "solid" : "outline"}
                  colorPalette="red"
                  fontFamily="mono"
                  onClick={() => setView({ kind: "played" })}
                >
                  {b.san}
                </Button>
                {pvFens.length > 0 && (
                  <Text as="span" color="fg.subtle" alignSelf="center" px="0.5" aria-hidden>
                    |
                  </Text>
                )}
                {pvSan.slice(0, pvFens.length).map((san, i) => (
                  <Button
                    key={`${i}${san}`}
                    size="xs"
                    fontFamily="mono"
                    colorPalette="green"
                    variant={view.kind === "pv" && view.index === i ? "solid" : i === 0 ? "subtle" : "ghost"}
                    onClick={() => setView({ kind: "pv", index: i })}
                  >
                    {san}
                  </Button>
                ))}
                {b.pvUci.length > pvFens.length && pvFens.length > 0 && (
                  <Text as="span" color="fg.subtle" alignSelf="center">
                    …
                  </Text>
                )}
              </Wrap>
            </Box>

            <Text fontSize="xs" color="fg.muted">
              Material: {b.materialBalance}
            </Text>

            <Box borderLeftWidth="3px" borderColor="purple.solid" pl="4" py="1" minH="20">
              <Text fontSize="xs" fontWeight="semibold" color="fg.muted" textTransform="uppercase" letterSpacing="wider" mb="1.5">
                Why it was bad
                {explanation.cached && (
                  <Text as="span" fontWeight="normal" textTransform="none" letterSpacing="normal" color="fg.subtle">
                    {" "}
                    · cached
                  </Text>
                )}
              </Text>
              <ExplanationBody state={explanation} />
            </Box>
          </Stack>
        </Flex>
      </Card.Body>
    </Card.Root>
  );
}

function ExplanationBody({ state }: { state: ReturnType<typeof useExplanation> }) {
  if (state.status === "loading") {
    return (
      <Stack gap="2" aria-busy="true" aria-label="Explanation loading">
        <Skeleton h="3.5" w="95%" />
        <Skeleton h="3.5" w="88%" />
        <Skeleton h="3.5" w="60%" />
      </Stack>
    );
  }
  if (state.status === "unavailable") {
    return (
      <Text fontSize="sm" color="fg.muted">
        AI explanations are switched off on this deployment, so here is the engine&apos;s view only: compare the red arrow (what was
        played) with the green one (what Stockfish wanted) and step through the line above.
      </Text>
    );
  }
  if (state.status === "rate-limited" || state.status === "error") {
    return (
      <Text fontSize="sm" color={state.status === "error" ? "fg.error" : "fg.warning"}>
        {state.message} The engine line above still shows the better move.
      </Text>
    );
  }
  return (
    <Text fontSize={{ base: "sm", md: "md" }} lineHeight="1.7" whiteSpace="pre-wrap" aria-live="polite">
      {state.text}
      {state.status === "streaming" && (
        <Box
          as="span"
          display="inline-block"
          w="0.5ch"
          h="1em"
          ml="0.5"
          verticalAlign="text-bottom"
          bg="fg.muted"
          animation="pulse 1s ease-in-out infinite"
        />
      )}
    </Text>
  );
}
