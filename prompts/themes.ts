import type { Blunder } from "../lib/chess/types";

export const THEMES = [
  "hanging piece",
  "fork",
  "pin",
  "skewer",
  "discovered attack",
  "back rank",
  "mate threat",
  "missed mate",
  "trapped piece",
  "overloaded defender",
  "pawn structure",
  "king safety",
  "endgame technique",
  "tempo / development",
  "positional",
] as const;

export type Theme = (typeof THEMES)[number];

export type Level = 1000 | 1600 | 2200;

export const LEVELS: readonly Level[] = [1000, 1600, 2200];

export function toTheme(value: unknown): Theme | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  return (THEMES as readonly string[]).includes(v) ? (v as Theme) : null;
}

export type PromptVersion = "v1" | "v2";

export type PromptDef = {
  version: PromptVersion;
  system: string;
  buildUser(b: Blunder, level: Level): string;
};
