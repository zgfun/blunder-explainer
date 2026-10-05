"use client";

import { Button, Container, HStack, Heading, Stack, Text } from "@chakra-ui/react";
import NextLink from "next/link";
import { SiteShell } from "./SiteShell";

function Status({ code, title, body, children }: { code: string; title: string; body: string; children: React.ReactNode }) {
  return (
    <SiteShell>
      <Container maxW="xl" px={{ base: "4", md: "6" }} py={{ base: "16", md: "24" }}>
        <Stack gap="4" textAlign="center" align="center">
          <Text fontFamily="mono" fontSize="5xl" fontWeight="bold" color="red.fg" lineHeight="1">
            {code}
          </Text>
          <Heading as="h1" fontSize={{ base: "2xl", md: "3xl" }}>
            {title}
          </Heading>
          <Text color="fg.muted">{body}</Text>
          <HStack gap="2" mt="2">
            {children}
          </HStack>
        </Stack>
      </Container>
    </SiteShell>
  );
}

export function NotFoundClient() {
  return (
    <Status code="??" title="That square is empty" body="The page you were looking for doesn't exist.">
      <Button asChild colorPalette="green">
        <NextLink href="/">Back to the start</NextLink>
      </Button>
      <Button asChild variant="outline">
        <NextLink href="/sample">See the sample game</NextLink>
      </Button>
    </Status>
  );
}

export function ErrorClient({ retry, digest }: { retry: () => void; digest?: string }) {
  return (
    <Status code="?!" title="Something went wrong" body={`An unexpected error interrupted the analysis.${digest ? ` (ref ${digest})` : ""}`}>
      <Button colorPalette="green" onClick={() => retry()}>
        Try again
      </Button>
      <Button asChild variant="outline">
        <NextLink href="/">Home</NextLink>
      </Button>
    </Status>
  );
}
