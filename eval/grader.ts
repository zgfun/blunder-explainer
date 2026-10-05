import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { uciLineToSan } from "@/lib/chess/pgn";
import { GRADER_MODEL } from "@/lib/llm/client";
import type { TestPosition } from "./types";

export const GradeSchema = z.object({
  correct: z.boolean(),
  mentionsRightIdea: z.boolean(),
  contradictsEngine: z.boolean(),
  inventsMoves: z.boolean(),
  reason: z.string(),
});

export type Grade = z.infer<typeof GradeSchema>;

export const GRADER_SYSTEM = `You grade short chess explanations written for club players. Each explanation is about one mistake: a move that a Lichess puzzle shows to be a blunder, because it allowed the opponent a winning tactic.

You get the ground truth: the position (FEN) before the mistake, the move played, Stockfish's best move and line, Stockfish's reply line after the mistake, the evaluations, the opponent's winning reply sequence from the puzzle, and the puzzle's theme tags. Then the explanation.

Judge each field strictly and independently:
- mentionsRightIdea: the explanation identifies WHY the move fails in a way that matches the ground truth: the tactic the opponent's winning sequence uses (for example the fork, pin, back-rank mate, or the piece left hanging), or the concrete consequence the engine line shows. A vague "this weakens your position" is not enough.
- contradictsEngine: the explanation states something the ground truth refutes: a wrong evaluation direction, a claim that the played move was fine, a wrong piece or square for the threat, or a better move other than the engine's best move.
- inventsMoves: the explanation recommends or analyses moves or variations that are not in the engine line, not in the engine reply line and not in the opponent's winning sequence. Naming the move played or describing an idea in words without notation is fine.
- correct: true only if mentionsRightIdea is true, contradictsEngine is false, inventsMoves is false, and every concrete chess claim (which piece, which square, what is attacked) is accurate in the given position. Simplified wording for beginners is fine; wrong facts are not.
- reason: one or two sentences justifying the verdict, naming the decisive fact.

Check the position yourself before deciding; do not give credit for confident-sounding prose.`;

function side(fen: string): string {
  return fen.split(" ")[1] === "w" ? "White" : "Black";
}

function pawns(v: number): string {
  if (v >= 99.5) return "forced mate for White";
  if (v <= -99.5) return "forced mate for Black";
  return `${v > 0 ? "+" : ""}${v.toFixed(2)} (White's perspective)`;
}

export function buildGraderPrompt(position: TestPosition, explanation: string): string {
  const b = position.blunder;
  const refutation = uciLineToSan(b.fenAfter, position.solutionUci, position.solutionUci.length);
  return [
    "<ground_truth>",
    `FEN before the mistake: ${b.fenBefore}`,
    `Side to move: ${side(b.fenBefore)}`,
    `Move played (the mistake): ${b.san}`,
    `Stockfish best move: ${b.bestSan}`,
    `Stockfish line from the same position: ${b.pvSan.join(" ")}`,
    `Stockfish reply line after the mistake: ${b.refutationSan.join(" ") || "(none)"}`,
    `Evaluation before the mistake: ${pawns(b.evalBeforePawns)}`,
    `Evaluation after the mistake: ${pawns(b.evalAfterPawns)}`,
    `Material before the mistake: ${b.materialBalance}`,
    `Opponent's winning sequence after the mistake (puzzle solution): ${refutation.join(" ")}`,
    `Puzzle theme tags: ${position.lichessThemes.join(", ")}`,
    `Acceptable explanation themes: ${position.acceptableThemes.join(", ")}`,
    "</ground_truth>",
    "",
    "<explanation>",
    explanation,
    "</explanation>",
  ].join("\n");
}

export async function gradeExplanation(
  client: Anthropic,
  position: TestPosition,
  explanation: string,
): Promise<{ grade: Grade | null; error?: string }> {
  const response = await client.messages.parse({
    model: GRADER_MODEL,
    max_tokens: 16000,
    output_config: { effort: "high", format: zodOutputFormat(GradeSchema) },
    system: GRADER_SYSTEM,
    messages: [{ role: "user", content: buildGraderPrompt(position, explanation) }],
  });
  if (response.stop_reason === "refusal") return { grade: null, error: "grader refused" };
  if (response.stop_reason === "max_tokens") return { grade: null, error: "grader hit max_tokens" };
  if (!response.parsed_output) return { grade: null, error: "grader output did not match the schema" };
  return { grade: response.parsed_output };
}
