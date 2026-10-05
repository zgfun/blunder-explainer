"use client";

import { Box, Container, Flex, HStack, IconButton, Link, Stack, Text } from "@chakra-ui/react";
import NextLink from "next/link";
import { useTheme } from "next-themes";
import { useSyncExternalStore, type ReactNode } from "react";

const subscribe = () => () => {};

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  const dark = mounted && resolvedTheme === "dark";
  return (
    <IconButton
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      variant="ghost"
      size="sm"
      onClick={() => setTheme(dark ? "light" : "dark")}
    >
      {!mounted ? null : dark ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      )}
    </IconButton>
  );
}

export function Logo() {
  return (
    <Link asChild _hover={{ textDecoration: "none" }} fontWeight="semibold" letterSpacing="-0.01em">
      <NextLink href="/">
        <Flex boxSize="7" borderRadius="md" bg="green.solid" color="green.contrast" align="center" justify="center" fontSize="sm" fontWeight="bold" fontFamily="mono">
          ??
        </Flex>
        <Text as="span">Blunder Explainer</Text>
      </NextLink>
    </Link>
  );
}

export function SiteShell({ children }: { children: ReactNode }) {
  return (
    <Flex direction="column" minH="100dvh" bg="bg">
      <Box as="header" borderBottomWidth="1px" borderColor="border.muted" bg="bg/80" backdropFilter="blur(8px)" position="sticky" top="0" zIndex="sticky">
        <Container maxW="5xl" px={{ base: "4", md: "6" }}>
          <Flex h="14" align="center" justify="space-between">
            <Logo />
            <HStack gap="1">
              <Link asChild fontSize="sm" color="fg.muted" px="2">
                <NextLink href="/sample">Sample game</NextLink>
              </Link>
              <ThemeToggle />
            </HStack>
          </Flex>
        </Container>
      </Box>
      <Box as="main" flex="1">
        {children}
      </Box>
      <Box as="footer" borderTopWidth="1px" borderColor="border.muted" mt="16">
        <Container maxW="5xl" px={{ base: "4", md: "6" }} py="6">
          <Stack direction={{ base: "column", md: "row" }} justify="space-between" gap="2" fontSize="xs" color="fg.muted">
            <Text>Stockfish is GPL-3.0; this project is open source.</Text>
            <Text>Games via the chess.com public API · explanations by Claude</Text>
          </Stack>
        </Container>
      </Box>
    </Flex>
  );
}
