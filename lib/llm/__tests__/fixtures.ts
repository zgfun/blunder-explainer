import type Anthropic from "@anthropic-ai/sdk";
import { vi } from "vitest";
import { deriveBlunder, type ExplainInput } from "../derive";

// 1.e4 e5 2.Bc4 Nc6 3.Qh5, Black to move; 3...Nf6?? allows Qxf7#. Line verified with Stockfish.
export const SCHOLAR_INPUT: ExplainInput = {
  fenBefore: "r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3",
  playedUci: "g8f6",
  bestUci: "g7g6",
  pvUci: ["g7g6", "h5d1", "f8g7", "d2d3", "c6a5", "b1c3"],
  evalBeforeCp: -29,
  evalAfterCp: 99900,
};

export const SCHOLAR_BLUNDER = deriveBlunder(SCHOLAR_INPUT);

export const GOOD_ANSWER =
  '{"theme":"mate threat"}\nYour knight move ignores the threat on f7. The queen and bishop both hit it, so the queen can take there with checkmate. The better plan was g6, and after Qd1 Bg7 you are fine.';

type FakeMessage = {
  content?: unknown[];
  stop_reason?: string | null;
  model?: string;
  usage?: Record<string, number | null>;
};

export function fakeStream(deltas: string[], final: FakeMessage = {}, opts: { failAfter?: number; error?: unknown } = {}) {
  const text = deltas.join("");
  const message = {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: final.model ?? "claude-sonnet-5-5",
    content: final.content ?? [{ type: "text", text, citations: null }],
    stop_reason: final.stop_reason === undefined ? "end_turn" : final.stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 40, output_tokens: 60, cache_read_input_tokens: 900, cache_creation_input_tokens: 0, ...final.usage },
  };
  const abort = vi.fn();
  return {
    abort,
    async *[Symbol.asyncIterator]() {
      if (opts.failAfter !== undefined && opts.failAfter >= deltas.length) throw opts.error ?? new Error("socket hang up");
      for (let i = 0; i < deltas.length; i++) {
        if (opts.failAfter !== undefined && i === opts.failAfter) throw opts.error ?? new Error("socket hang up");
        yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: deltas[i] } };
      }
    },
    finalMessage: async () => message,
  };
}

export function fakeClient(make: () => ReturnType<typeof fakeStream>) {
  const stream = vi.fn((params: unknown, options?: unknown) => {
    void params;
    void options;
    return make();
  });
  const client = { beta: { messages: { stream } } } as unknown as Anthropic;
  return { client, stream };
}
