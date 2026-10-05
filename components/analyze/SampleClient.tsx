"use client";

import { Button, Container, Flex, Heading, Stack, Text } from "@chakra-ui/react";
import NextLink from "next/link";
import type { EngineLine } from "@/lib/chess/types";
import { AnalysisView } from "./AnalysisView";
import type { GameInput } from "./format";
import { SiteShell } from "./SiteShell";

export function SampleClient({ game, lines, note }: { game: GameInput; lines?: EngineLine[]; note?: string }) {
  return (
    <SiteShell>
      <Container maxW="5xl" px={{ base: "4", md: "6" }} pt={{ base: "8", md: "12" }}>
        <Flex justify="space-between" align={{ base: "flex-start", sm: "flex-end" }} gap="4" mb="6" direction={{ base: "column", sm: "row" }}>
          <Stack gap="1">
            <Text fontSize="xs" fontWeight="semibold" letterSpacing="widest" textTransform="uppercase" color="green.fg">
              Sample game
            </Text>
            <Heading as="h1" fontSize={{ base: "2xl", md: "3xl" }} letterSpacing="-0.02em">
              Three moves that decided this game
            </Heading>
            <Text fontSize="sm" color="fg.muted">
              Engine analysis is precomputed so this page is instant. Switch sides or the explanation level to explore.
            </Text>
          </Stack>
          <Button asChild variant="outline" size="sm" flexShrink={0}>
            <NextLink href="/">Analyse your own game</NextLink>
          </Button>
        </Flex>
        <AnalysisView game={game} lines={lines} note={note} />
      </Container>
    </SiteShell>
  );
}
