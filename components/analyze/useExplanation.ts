"use client";

import { useCallback, useEffect, useState } from "react";
import type { Blunder } from "@/lib/chess/types";
import { explainHeaders, getApiKey, getKeyVersion, openKeyDialog, useApiKey, type KeyDialogReason } from "./apiKey";
import { splitExplanation, type Level } from "./format";

export type ExplainStatus =
  | "loading"
  | "streaming"
  | "done"
  /** No cached text and no key to generate one: show the bring-your-own-key call to action. */
  | "needs-key"
  | "invalid-key"
  | "insufficient-credit"
  | "rate-limited"
  | "error";

export type ExplainState = {
  status: ExplainStatus;
  theme: string | null;
  text: string;
  cached: boolean;
  message?: string;
  /** Rate limited on the site's own budget: adding a key gets past it. */
  needsKey?: boolean;
  /** Worth retrying as-is (a dropped connection, an overloaded provider). */
  retryable?: boolean;
  /** For a key problem: what the key dialog should explain. */
  keyReason?: Exclude<KeyDialogReason, null>;
};

// Session memo: only explanations that streamed to a clean end. They don't depend on the key.
const done = new Map<string, ExplainState>();

// Failures, per card *and* key version: a card isn't asked again under the same key (until a rate
// limit runs out), but adding or changing a key retries it. Failures are never shared between cards:
// another card may well have a cached explanation, which the server serves to anyone, key or not,
// and a miss comes back as a quick 503.
const failures = new Map<string, { until: number; value: ExplainState }>();
// The key dialog opens by itself at most once per key version, not once per card.
let dialogOpenedFor = -1;

function keyOf(b: Blunder, level: Level) {
  return `${b.fenBefore}|${b.uci}|${b.bestUci}|${b.pvUci.join(" ")}|${level}`;
}

function minutes(seconds: number): string {
  const m = Math.max(1, Math.ceil(seconds / 60));
  return m === 1 ? "a minute" : `${m} minutes`;
}

function wait(seconds: number): string {
  return seconds < 60 ? `${Math.max(1, Math.round(seconds))} seconds` : minutes(seconds);
}

const LOADING: ExplainState = { status: "loading", theme: null, text: "", cached: false };
const EMPTY = { theme: null, text: "", cached: false };

const failureId = (key: string, version: number) => `${key}#${version}`;

/** What to show without a request: a memoised answer, or this card's failure under the current key. */
function known(key: string): ExplainState | null {
  const hit = done.get(key);
  if (hit) return hit;
  const id = failureId(key, getKeyVersion());
  const failure = failures.get(id);
  if (!failure) return null;
  if (Date.now() < failure.until) return failure.value;
  failures.delete(id);
  return null;
}

type ErrorBody = { error?: string; message?: string; retryAfter?: number; needsKey?: boolean };

/** Turns an error response into a card state, remembered for this card and key (see `failures`). */
function failureState(status: number, data: ErrorBody, cardKey: string, version: number): ExplainState {
  const share = (value: ExplainState, seconds = Number.POSITIVE_INFINITY) => {
    failures.set(failureId(cardKey, version), { until: Date.now() + seconds * 1000, value });
    return value;
  };
  const retryAfter = typeof data.retryAfter === "number" && data.retryAfter > 0 ? data.retryAfter : 3600;
  switch (data.error) {
    case "explanations-unavailable":
      return share({ status: "needs-key", ...EMPTY });
    case "invalid-key":
      return share({ status: "invalid-key", ...EMPTY, keyReason: "invalid-key", message: "Anthropic did not accept your API key." });
    case "malformed-key":
      return share({
        status: "invalid-key",
        ...EMPTY,
        keyReason: "malformed-key",
        message: "That doesn't look like a complete Anthropic key: it can only contain letters, digits, - and _.",
      });
    case "insufficient-credit":
      return share({
        status: "insufficient-credit",
        ...EMPTY,
        keyReason: "insufficient-credit",
        message: "Your Anthropic account is out of credit, or this key isn't allowed to use the model.",
      });
    case "provider-rate-limited":
      return share(
        { status: "rate-limited", ...EMPTY, message: `Anthropic is rate-limiting your key. Try again in ${wait(retryAfter)}.` },
        retryAfter,
      );
    case "provider-overloaded":
      return { status: "error", ...EMPTY, retryable: true, message: "Anthropic is overloaded right now. Try again in a moment." };
    case "rate-limited":
      return share(
        {
          status: "rate-limited",
          ...EMPTY,
          needsKey: Boolean(data.needsKey),
          message: data.needsKey
            ? "Today's free explanations are used up."
            : `Explanation limit reached. Try again in ${minutes(retryAfter)}.`,
        },
        retryAfter,
      );
    default:
      if (status === 503) return share({ status: "needs-key", ...EMPTY });
      return { status: "error", ...EMPTY, retryable: true, message: "The explanation could not be generated." };
  }
}

export function useExplanation(b: Blunder, level: Level): ExplainState & { retry: () => void } {
  const key = keyOf(b, level);
  const { version } = useApiKey();
  const [nonce, setNonce] = useState(0);
  const id = `${key}#${version}#${nonce}`;
  const [state, setState] = useState<{ id: string; value: ExplainState }>(() => ({ id, value: known(key) ?? LOADING }));
  if (state.id !== id) setState({ id, value: known(key) ?? LOADING });

  const retry = useCallback(() => {
    failures.delete(failureId(key, getKeyVersion()));
    setNonce((n) => n + 1);
  }, [key]);

  useEffect(() => {
    // Render already initialised the state from known(key).
    if (known(key)) return;
    const ctrl = new AbortController();
    const set = (value: ExplainState) => {
      if (!ctrl.signal.aborted) setState({ id, value });
    };
    let partial = { theme: null as string | null, text: "", cached: false };

    (async () => {
      const sentVersion = getKeyVersion();
      const res = await fetch("/api/explain", {
        method: "POST",
        headers: explainHeaders(getApiKey()),
        signal: ctrl.signal,
        body: JSON.stringify({
          fenBefore: b.fenBefore,
          playedUci: b.uci,
          level,
          bestUci: b.bestUci,
          pvUci: b.pvUci.slice(0, 12),
          refutationUci: (b.refutationUci ?? []).slice(0, 12),
          evalBeforeCp: Math.round(b.evalBeforePawns * 100),
          evalAfterCp: Math.round(b.evalAfterPawns * 100),
        }),
      });

      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => ({}))) as ErrorBody;
        if (ctrl.signal.aborted) return;
        const failure = failureState(res.status, data, key, sentVersion);
        set(failure);
        // Point the visitor at the key dialog once per key, not once per card.
        if (failure.keyReason && dialogOpenedFor !== sentVersion) {
          dialogOpenedFor = sentVersion;
          openKeyDialog(failure.keyReason);
        }
        return;
      }

      const cached = res.headers.get("x-cache") === "hit";
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        // The server errors the body when the text is incomplete, so this throws in that case.
        const { value, done: finished } = await reader.read();
        if (finished) break;
        buffer += decoder.decode(value, { stream: true });
        const part = splitExplanation(buffer, false);
        partial = { theme: part.theme, text: part.body, cached };
        set({ status: part.pending ? "loading" : "streaming", ...partial });
      }
      buffer += decoder.decode();
      const final = splitExplanation(buffer, true);
      if (!final.body) {
        set({ status: "error", theme: null, text: "", cached, retryable: true, message: "The explanation came back empty." });
        return;
      }
      const result: ExplainState = { status: "done", theme: final.theme, text: final.body, cached };
      done.set(key, result);
      set(result);
    })().catch((err: unknown) => {
      if (ctrl.signal.aborted) return;
      console.error(err);
      set({
        status: "error",
        ...partial,
        retryable: true,
        message: partial.text ? "The explanation was cut off." : "Lost the connection while explaining.",
      });
    });

    return () => ctrl.abort();
    // The id captures every field the request depends on, plus the key version and retries.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return { ...state.value, retry };
}
