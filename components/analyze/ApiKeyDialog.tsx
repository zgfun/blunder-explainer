"use client";

import {
  Alert,
  Box,
  Button,
  Checkbox,
  CloseButton,
  Dialog,
  Field,
  HStack,
  IconButton,
  Input,
  InputGroup,
  Link,
  Portal,
  Stack,
  Text,
} from "@chakra-ui/react";
import { useRef, useState, type RefObject } from "react";
import {
  closeKeyDialog,
  CONSOLE_KEYS_URL,
  forgetApiKey,
  KEY_PREFIX,
  keyFormatProblem,
  looksLikeAnthropicKey,
  openKeyDialog,
  saveApiKey,
  useApiKey,
  type KeyDialogReason,
} from "./apiKey";

function KeyIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="7.5" cy="15.5" r="4.5" />
      <path d="M10.7 12.3 21 2M16 7l3 3M18.5 4.5l2 2" />
    </svg>
  );
}

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      {off && <path d="M3 3l18 18" />}
    </svg>
  );
}

const REASON_TEXT: Record<Exclude<KeyDialogReason, null>, { title: string; body: string }> = {
  "invalid-key": {
    title: "Anthropic did not accept this key",
    body: "Check that you copied the whole key and that it hasn't been revoked, or create a new one.",
  },
  "malformed-key": {
    title: "That doesn't look like a complete Anthropic key",
    body: "An Anthropic key can only contain letters, digits, - and _. Copy it again from the Console, or create a new one.",
  },
  "insufficient-credit": {
    title: "This key can't be used right now",
    body: "The Anthropic account is out of credit, or the key isn't allowed to use the model. Add credit under Plans & Billing in the Console, or use another key.",
  },
};

/** Header control: a key icon that opens the bring-your-own-key dialog. */
export function ApiKeyButton() {
  const { key } = useApiKey();
  return (
    <>
      <IconButton
        aria-label={key ? "Your Anthropic API key (set)" : "Add your Anthropic API key"}
        title={key ? "Your Anthropic API key is set" : "Explanations use your own Anthropic key"}
        variant="ghost"
        size="sm"
        position="relative"
        onClick={() => openKeyDialog()}
      >
        <KeyIcon />
        {key && (
          <Box position="absolute" top="1.5" right="1.5" boxSize="2" borderRadius="full" bg="green.solid" aria-hidden />
        )}
      </IconButton>
      <ApiKeyDialog />
    </>
  );
}

function ApiKeyDialog() {
  const { key, remember, dialog } = useApiKey();
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <Dialog.Root
      open={dialog.open}
      // Start in the key field, not on the first focusable element (the external Console link).
      initialFocusEl={() => inputRef.current}
      onOpenChange={(e) => {
        if (!e.open) closeKeyDialog();
      }}
      placement="center"
      size={{ base: "full", sm: "md" }}
    >
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            {/* Remount the form on every open so the draft starts from the saved values. */}
            {dialog.open && <KeyForm savedKey={key} savedRemember={remember} reason={dialog.reason} inputRef={inputRef} />}
            <Dialog.CloseTrigger asChild>
              <CloseButton size="sm" />
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}

function KeyForm({
  savedKey,
  savedRemember,
  reason,
  inputRef,
}: {
  savedKey: string | null;
  savedRemember: boolean;
  reason: KeyDialogReason;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const [draft, setDraft] = useState(savedKey ?? "");
  const [remember, setRemember] = useState(savedRemember);
  const [show, setShow] = useState(false);
  const trimmed = draft.trim();
  // A key with impossible characters can never work, so it blocks saving; a missing prefix only warns.
  const problem = keyFormatProblem(trimmed);
  const warn = trimmed.length > 0 && !problem && !looksLikeAnthropicKey(trimmed);
  const canSave = trimmed.length > 0 && !problem;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSave) saveApiKey(trimmed, remember);
      }}
    >
      <Dialog.Header>
        <Dialog.Title>Explanations use your own Anthropic key</Dialog.Title>
      </Dialog.Header>
      <Dialog.Body>
        <Stack gap="4">
          {reason && (
            <Alert.Root status="error" size="sm">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>{REASON_TEXT[reason].title}</Alert.Title>
                <Alert.Description>{REASON_TEXT[reason].body}</Alert.Description>
              </Alert.Content>
            </Alert.Root>
          )}
          <Text fontSize="sm" color="fg.muted">
            This site doesn&apos;t pay for AI explanations. Paste an Anthropic API key and each new explanation is billed to your own
            Anthropic account.{" "}
            <Link href={CONSOLE_KEYS_URL} target="_blank" rel="noreferrer" colorPalette="green" color="colorPalette.fg">
              Get a key at console.anthropic.com ↗
            </Link>
          </Text>

          <Field.Root invalid={Boolean(problem)}>
            <Field.Label>Anthropic API key</Field.Label>
            <InputGroup
              endElement={
                <IconButton
                  aria-label={show ? "Hide key" : "Show key"}
                  aria-pressed={show}
                  variant="ghost"
                  size="xs"
                  me="-2"
                  onClick={() => setShow((s) => !s)}
                >
                  <EyeIcon off={show} />
                </IconButton>
              }
            >
              <Input
                ref={inputRef}
                name="anthropic-api-key"
                type={show ? "text" : "password"}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={`${KEY_PREFIX}…`}
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                data-1p-ignore
                data-lpignore="true"
                fontFamily="mono"
              />
            </InputGroup>
            {problem && (
              <Field.ErrorText>
                {problem === "too-long"
                  ? "This is longer than any Anthropic key. Check that only the key was copied."
                  : "This key contains characters an Anthropic key can't have (only letters, digits, - and _). Check for spaces or a dash changed by autocorrect, and copy it again from the Console."}
              </Field.ErrorText>
            )}
            {warn && (
              <Field.HelperText color="fg.warning">
                Anthropic keys usually start with &quot;{KEY_PREFIX}&quot;. You can still save it if you&apos;re sure.
              </Field.HelperText>
            )}
          </Field.Root>

          <Checkbox.Root checked={remember} onCheckedChange={(e) => setRemember(e.checked === true)} size="sm">
            <Checkbox.HiddenInput />
            <Checkbox.Control />
            <Checkbox.Label>Remember on this device</Checkbox.Label>
          </Checkbox.Root>
          <Text fontSize="xs" color="fg.muted" mt="-2">
            {remember
              ? "Kept in this browser's local storage until you forget it."
              : "Kept only for this tab and forgotten when you close it."}
          </Text>

          <Box bg="bg.subtle" borderRadius="md" p="3">
            <Text fontSize="xs" color="fg.muted">
              Your key stays in your browser and is sent only with each explanation request over HTTPS. The server uses it for
              that one request and never stores or logs it. Generated explanations are cached and shown to other visitors who
              analyse the same position; only chess positions are involved, no personal data.
            </Text>
          </Box>
        </Stack>
      </Dialog.Body>
      <Dialog.Footer>
        <HStack justify="space-between" w="full" gap="2">
          {savedKey ? (
            <Button variant="ghost" colorPalette="red" size="sm" onClick={() => forgetApiKey()}>
              Forget key
            </Button>
          ) : (
            <span />
          )}
          <HStack gap="2">
            <Dialog.ActionTrigger asChild>
              <Button variant="outline" size="sm">
                Cancel
              </Button>
            </Dialog.ActionTrigger>
            <Button type="submit" colorPalette="green" size="sm" disabled={!canSave}>
              Save and explain
            </Button>
          </HStack>
        </HStack>
      </Dialog.Footer>
    </form>
  );
}
