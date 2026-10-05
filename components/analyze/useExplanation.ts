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

const done = new Map<string, ExplainState>();

function keyOf(b: Blunder, level: Level) {
  return `${b.fenBefore}|${b.uci}|${level}`;
}

function minutes(seconds: unknown): string {
  const s = typeof seconds === "number" && seconds > 0 ? seconds : 3600;
  const m = Math.max(1, Math.ceil(s / 60));
  return m === 1 ? "a minute" : `${m} minutes`;
}

const LOADING: ExplainState = { status: "loading", theme: null, text: "", cached: false };

export function useExplanation(b: Blunder, level: Level): ExplainState {
  const key = keyOf(b, level);
  const [state, setState] = useState<{ key: string; value: ExplainState }>(() => ({ key, value: done.get(key) ?? LOADING }));
  if (state.key !== key) setState({ key, value: done.get(key) ?? LOADING });

  useEffect(() => {
    if (done.has(key)) return;
    const ctrl = new AbortController();
    const set = (value: ExplainState) => {
      if (!ctrl.signal.aborted) setState({ key, value });
    };

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
          evalBeforeCp: Math.round(b.evalBeforePawns * 100),
          evalAfterCp: Math.round(b.evalAfterPawns * 100),
        }),
      });

      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string; retryAfter?: number };
        if (res.status === 503 || data.error === "explanations-unavailable") {
          set({ status: "unavailable", theme: null, text: "", cached: false });
        } else if (res.status === 429) {
          set({
            status: "rate-limited",
            theme: null,
            text: "",
            cached: false,
            message: `Explanation limit reached. Try again in ${minutes(data.retryAfter)}.`,
          });
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
        const { value, done: finished } = await reader.read();
        if (finished) break;
        buffer += decoder.decode(value, { stream: true });
        const part = splitExplanation(buffer, false);
        set({ status: part.pending ? "loading" : "streaming", theme: part.theme, text: part.body, cached });
      }
      buffer += decoder.decode();
      const final = splitExplanation(buffer, true);
      const result: ExplainState = final.body
        ? { status: "done", theme: final.theme, text: final.body, cached }
        : { status: "error", theme: null, text: "", cached, message: "The explanation came back empty." };
      if (result.status === "done") done.set(key, result);
      set(result);
    })().catch((err: unknown) => {
      if (ctrl.signal.aborted) return;
      console.error(err);
      set({ status: "error", theme: null, text: "", cached: false, message: "Lost the connection while explaining." });
    });

    return () => ctrl.abort();
    // The key captures every field the request depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state.value;
}
