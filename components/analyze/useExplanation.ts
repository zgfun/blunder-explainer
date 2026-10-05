"use client";

import { useEffect, useState } from "react";
import type { Blunder } from "@/lib/chess/types";
import { splitExplanation, type Level } from "./format";

export type ExplainStatus = "loading" | "streaming" | "done" | "unavailable" | "rate-limited" | "error";

export type ExplainState = {
  status: ExplainStatus;
  theme: string | null;
  text: string;
  cached: boolean;
  message?: string;
};

// Session memo: only explanations that streamed to a clean end, so failures are retried.
const done = new Map<string, ExplainState>();
// A deployment without a key stays that way for the session; don't re-ask on every toggle.
let unavailable = false;
let rateLimitedUntil = 0;
let rateLimitedMessage = "";

function keyOf(b: Blunder, level: Level) {
  return `${b.fenBefore}|${b.uci}|${b.bestUci}|${b.pvUci.join(" ")}|${level}`;
}

function minutes(seconds: number): string {
  const m = Math.max(1, Math.ceil(seconds / 60));
  return m === 1 ? "a minute" : `${m} minutes`;
}

const LOADING: ExplainState = { status: "loading", theme: null, text: "", cached: false };
const UNAVAILABLE: ExplainState = { status: "unavailable", theme: null, text: "", cached: false };

/** What to show without a request: a memoised answer or a session-wide failure. */
function known(key: string): ExplainState | null {
  const hit = done.get(key);
  if (hit) return hit;
  if (unavailable) return UNAVAILABLE;
  if (Date.now() < rateLimitedUntil) {
    return { status: "rate-limited", theme: null, text: "", cached: false, message: rateLimitedMessage };
  }
  return null;
}

export function useExplanation(b: Blunder, level: Level): ExplainState {
  const key = keyOf(b, level);
  const [state, setState] = useState<{ key: string; value: ExplainState }>(() => ({ key, value: known(key) ?? LOADING }));
  if (state.key !== key) setState({ key, value: known(key) ?? LOADING });

  useEffect(() => {
    // Render already initialised the state from known(key).
    if (known(key)) return;
    const ctrl = new AbortController();
    const set = (value: ExplainState) => {
      if (!ctrl.signal.aborted) setState({ key, value });
    };
    let partial = { theme: null as string | null, text: "", cached: false };

    (async () => {
      const res = await fetch("/api/explain", {
        method: "POST",
        headers: { "content-type": "application/json" },
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
        const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string; retryAfter?: number };
        if (res.status === 503 || data.error === "explanations-unavailable") {
          unavailable = true;
          set(UNAVAILABLE);
        } else if (res.status === 429) {
          const seconds = typeof data.retryAfter === "number" && data.retryAfter > 0 ? data.retryAfter : 3600;
          rateLimitedUntil = Date.now() + seconds * 1000;
          rateLimitedMessage = `Explanation limit reached. Try again in ${minutes(seconds)}.`;
          set({ status: "rate-limited", theme: null, text: "", cached: false, message: rateLimitedMessage });
        } else {
          set({ status: "error", theme: null, text: "", cached: false, message: "The explanation could not be generated." });
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
        set({ status: "error", theme: null, text: "", cached, message: "The explanation came back empty." });
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
        message: partial.text ? "The explanation was cut off." : "Lost the connection while explaining.",
      });
    });

    return () => ctrl.abort();
    // The key captures every field the request depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state.value;
}
