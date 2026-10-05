import Anthropic from "@anthropic-ai/sdk";

export const EXPLAIN_MODEL = "claude-sonnet-5-5";
export const GRADER_MODEL = "claude-opus-5-5";

let cached: { key: string; client: Anthropic } | null = null;

/** Returns null when ANTHROPIC_API_KEY is unset so callers can degrade instead of throwing. */
export function getClient(): Anthropic | null {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return null;
  if (cached?.key !== key) cached = { key, client: new Anthropic({ apiKey: key }) };
  return cached.client;
}
