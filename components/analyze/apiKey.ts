"use client";

import { useSyncExternalStore } from "react";
import { KEY_CHARSET, MAX_VISITOR_KEY_LENGTH } from "@/lib/llm/visitor-key";

/**
 * The visitor's own Anthropic API key. It lives only in this browser (localStorage when
 * "remember" is on, sessionStorage otherwise) and is sent only as the x-anthropic-key header
 * on POST /api/explain. Every storage access is guarded: private modes and blocked site data throw.
 */
const STORAGE_KEY = "blunder-explainer:anthropic-key";
export const KEY_HEADER = "x-anthropic-key";
export const KEY_PREFIX = "sk-ant-";
export const CONSOLE_KEYS_URL = "https://console.anthropic.com/settings/keys";

export type KeyDialogReason = "invalid-key" | "malformed-key" | "insufficient-credit" | null;

export type ApiKeyState = {
  key: string | null;
  remember: boolean;
  /** Bumped whenever the key changes, so per-key results (failures) are never reused across keys. */
  version: number;
  dialog: { open: boolean; reason: KeyDialogReason };
};

const SERVER_STATE: ApiKeyState = { key: null, remember: true, version: 0, dialog: { open: false, reason: null } };

let state: ApiKeyState | null = null;
const listeners = new Set<() => void>();

function storage(kind: "local" | "session"): Storage | null {
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function read(kind: "local" | "session"): string | null {
  try {
    return storage(kind)?.getItem(STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

function write(kind: "local" | "session", value: string | null) {
  try {
    const s = storage(kind);
    if (!s) return;
    if (value) s.setItem(STORAGE_KEY, value);
    else s.removeItem(STORAGE_KEY);
  } catch {
    // Storage full or blocked: the key still works for this page view, held in memory.
  }
}

function current(): ApiKeyState {
  if (state) return state;
  if (typeof window === "undefined") return SERVER_STATE;
  const local = read("local");
  const session = local ? null : read("session");
  state = { key: local ?? session, remember: !session, version: 0, dialog: { open: false, reason: null } };
  return state;
}

function update(next: Partial<ApiKeyState>) {
  state = { ...current(), ...next };
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useApiKey(): ApiKeyState {
  return useSyncExternalStore(subscribe, current, () => SERVER_STATE);
}

/** The key to send right now, read at request time rather than captured at render. */
export function getApiKey(): string | null {
  return current().key;
}

export function getKeyVersion(): number {
  return current().version;
}

export function saveApiKey(raw: string, remember: boolean) {
  const key = raw.trim() || null;
  write(remember ? "local" : "session", key);
  write(remember ? "session" : "local", null);
  // Always a new version, so saving (even the same key again) retries anything that failed.
  update({ key, remember, version: current().version + 1, dialog: { open: false, reason: null } });
}

export function forgetApiKey() {
  write("local", null);
  write("session", null);
  const s = current();
  update({ key: null, version: s.key ? s.version + 1 : s.version, dialog: { open: false, reason: null } });
}

export function openKeyDialog(reason: KeyDialogReason = null) {
  update({ dialog: { open: true, reason } });
}

export function closeKeyDialog() {
  update({ dialog: { open: false, reason: null } });
}

/** A gentle format check: Anthropic keys start with sk-ant-. A warning only, never a block. */
export function looksLikeAnthropicKey(value: string): boolean {
  return value.trim().startsWith(KEY_PREFIX);
}

/**
 * A hard format check, the same one the server applies: a key with any other character (a space,
 * an autocorrected dash, a smart quote) can never work, and one outside ISO-8859-1 can't even be
 * put in a request header.
 */
export function keyFormatProblem(value: string): "too-long" | "charset" | null {
  const key = value.trim();
  if (!key) return null;
  if (key.length > MAX_VISITOR_KEY_LENGTH) return "too-long";
  return KEY_CHARSET.test(key) ? null : "charset";
}

/**
 * Sent in place of a key that fails keyFormatProblem: not key-shaped, so the server still serves a
 * cached explanation but answers a cache miss with malformed-key, without contacting Anthropic and
 * without falling back to the site's own key. The malformed key itself never leaves the browser.
 */
export const MALFORMED_KEY_PLACEHOLDER = "(malformed)";

/** Headers for POST /api/explain. The key goes only here: never in the URL or the body. */
export function explainHeaders(key: string | null): Record<string, string> {
  if (!key) return { "content-type": "application/json" };
  return { "content-type": "application/json", [KEY_HEADER]: keyFormatProblem(key) ? MALFORMED_KEY_PLACEHOLDER : key };
}
