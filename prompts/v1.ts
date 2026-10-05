import type { Blunder } from "../lib/chess/types";
import { formatMoverEval, moveLabel, moverEvals, sideName } from "./format";
import { THEMES, type Level, type PromptDef } from "./themes";

// Baseline: short and unconstrained. Below the 512-token minimum cacheable prefix, so it never caches.
const system = `You are a friendly chess coach. A student made a mistake in a game. Explain in plain English why the move was bad and what they should have done instead.

Start your answer with one line of JSON naming the tactical theme, like {"theme":"fork"}, using one of: ${THEMES.join(", ")}. Then write the explanation on the next lines.`;

function buildUser(b: Blunder, level: Level): string {
  const evals = moverEvals(b);
  return [
    `The student is rated about ${level}.`,
    `Position (FEN): ${b.fenBefore}`,
    `${sideName(b.side)} played ${moveLabel(b)}.`,
    `The engine preferred ${b.bestSan}.`,
    `Evaluation for ${sideName(b.side)}: ${formatMoverEval(evals.before, b.side)} before, ${formatMoverEval(evals.after, b.side)} after.`,
  ].join("\n");
}

export const version = "v1" as const;
export { system, buildUser };
export const v1: PromptDef = { version, system, buildUser };
export default v1;
