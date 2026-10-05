"use client";

import { Box, Button, Container, Flex, Heading, SimpleGrid, Stack, Text } from "@chakra-ui/react";
import NextLink from "next/link";
import { useEffect, useRef, useState } from "react";
import { AnalysisView } from "./AnalysisView";
import { GameInputCard, type Loaded } from "./GameInputCard";
import { SiteShell } from "./SiteShell";

const STEPS = [
  { title: "Stockfish in your browser", body: "Every position is evaluated locally in a Web Worker. No engine server, nothing to wait for in a queue." },
  {
    title: "Claude explains, with your key",
    body: "Your three costliest moves get a short, plain-language reason and a better plan, pitched at your level. New explanations use your own Anthropic API key, which stays in your browser; each one is cached and shown to anyone who analyses the same position.",
  },
  { title: "Grounded in the engine line", body: "Explanations may only use the engine's own variation, so they can't invent moves that don't work." },
];

export function HomeClient({ initial }: { initial?: { url?: string; username?: string } }) {
  const [loaded, setLoaded] = useState<(Loaded & { key: number }) | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (loaded) resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [loaded]);

  const onLoaded = (l: Loaded) => {
    setLoaded({ ...l, key: Date.now() });
    try {
      const qs = l.query ? `?${new URLSearchParams(Object.entries(l.query).filter(([, v]) => !!v) as [string, string][])}` : "";
      window.history.replaceState(null, "", `/${qs}`);
    } catch {
      // Shareable URL is a nicety; ignore if history is unavailable.
    }
  };

  return (
    <SiteShell>
      <Box
        position="relative"
        overflow="hidden"
        bgImage="radial-gradient(ellipse 80% 60% at 50% -10%, color-mix(in srgb, var(--chakra-colors-green-500) 18%, transparent), transparent 70%)"
      >
        <Box
          position="absolute"
          inset="0"
          opacity={{ base: 0.04, _dark: 0.06 }}
          pointerEvents="none"
          bgImage="conic-gradient(currentColor 25%, transparent 0 50%, currentColor 0 75%, transparent 0)"
          bgSize="56px 56px"
          maskImage="linear-gradient(to bottom, black, transparent 75%)"
        />
        <Container maxW="3xl" px={{ base: "4", md: "6" }} pt={{ base: "12", md: "20" }} pb={{ base: "8", md: "12" }} position="relative">
          <Stack gap="4" textAlign="center" align="center" mb={{ base: "8", md: "10" }}>
            <Text fontSize="xs" fontWeight="semibold" letterSpacing="widest" textTransform="uppercase" color="green.fg">
              Stockfish + Claude
            </Text>
            <Heading as="h1" fontSize={{ base: "3xl", sm: "4xl", md: "5xl" }} lineHeight="1.1" letterSpacing="-0.02em" fontWeight="bold">
              Find and understand your worst moves
            </Heading>
            <Text fontSize={{ base: "md", md: "lg" }} color="fg.muted" maxW="xl">
              Paste a chess.com game. The engine finds your three costliest moves, and you get a plain-English reason for each one,
              right next to the board.
            </Text>
          </Stack>

          <GameInputCard onLoaded={onLoaded} initial={initial} />

          <Flex justify="center" mt="5">
            <Button asChild variant="outline" size="lg" borderRadius="full" px="6">
              <NextLink href="/sample">Try the sample game →</NextLink>
            </Button>
          </Flex>
        </Container>
      </Box>

      <Container maxW="5xl" px={{ base: "4", md: "6" }}>
        <Box ref={resultRef} scrollMarginTop="20">
          {loaded && (
            <Box pt="4" pb="4">
              <AnalysisView key={loaded.key} game={loaded.game} defaultSide={loaded.defaultSide} />
            </Box>
          )}
        </Box>

        <SimpleGrid columns={{ base: 1, md: 3 }} gap={{ base: "3", md: "4" }} mt={{ base: "8", md: "12" }}>
          {STEPS.map((s, i) => (
            <Stack key={s.title} gap="2" p="5" borderRadius="lg" borderWidth="1px" borderColor="border.muted" bg="bg.subtle">
              <Flex boxSize="7" borderRadius="full" bg="green.subtle" color="green.fg" align="center" justify="center" fontSize="sm" fontWeight="bold">
                {i + 1}
              </Flex>
              <Text fontWeight="semibold">{s.title}</Text>
              <Text fontSize="sm" color="fg.muted">
                {s.body}
              </Text>
            </Stack>
          ))}
        </SimpleGrid>
      </Container>
    </SiteShell>
  );
}
