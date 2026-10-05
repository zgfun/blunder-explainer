import { createHash } from "node:crypto";
import { CURRENT_PROMPT, type Level, type PromptDef } from "../../prompts";
import type { Blunder } from "../chess/types";

export type ExplanationKey = {
  /** Use the FEN exactly as chess.js prints it (Chess#fen()), so client and scripts agree. */
  fen: string;
  playedUci: string;
  level: Level;
  /** `${promptId}:${hash of the exact user message}`, see explanationKey. */
  promptVersion: string;
};

function sha(text: string, length: number): string {
  return createHash("sha256").update(text).digest("hex").slice(0, length);
}

// A fixed input, so a change to buildUser's template changes promptId too.
const FINGERPRINT_BLUNDER: Blunder = {
  ply: 5,
  side: "black",
  moveNumber: 3,
  san: "Nf6",
  uci: "g8f6",
  fenBefore: "r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3",
  fenAfter: "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4",
  bestUci: "g7g6",
  bestSan: "g6",
  pvSan: ["g6", "Qd1", "Nf6", "Nc3", "Bg7"],
  pvUci: ["g7g6", "h5d1", "g8f6", "b1c3", "f8g7"],
  refutationSan: ["Qxf7#"],
  refutationUci: ["h5f7"],
  evalBeforePawns: -0.32,
  evalAfterPawns: 100,
  cpLoss: 1532,
  materialBalance: "Material is equal",
  sideToMove: "black",
};

/**
 * Content-derived prompt version, e.g. "v2-1a2b3c4d". Editing the system text or the user
 * template changes it even if nobody bumps "v2", so cached rows and eval scores never mix
 * explanations written under different prompts.
 */
export function promptId(prompt: PromptDef = CURRENT_PROMPT): string {
  return `${prompt.version}-${sha(`${prompt.system}\u0000${prompt.buildUser(FINGERPRINT_BLUNDER, 1600)}`, 8)}`;
}

/**
 * Cache key for one explanation. The user message is built only from server-derived data
 * (best move, both engine lines, rounded evals, material), so hashing it makes every grounding
 * input part of the key: a request with a different engine line can never be served, or
 * overwrite, the text written for another one.
 */
export function explanationKey(b: Blunder, level: Level, prompt: PromptDef = CURRENT_PROMPT): ExplanationKey {
  return {
    fen: b.fenBefore,
    playedUci: b.uci,
    level,
    promptVersion: `${promptId(prompt)}:${sha(prompt.buildUser(b, level), 12)}`,
  };
}
