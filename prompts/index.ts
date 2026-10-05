import type { PromptDef, PromptVersion } from "./themes";
import { v1 } from "./v1";
import { v2 } from "./v2";

export { THEMES, LEVELS, toTheme } from "./themes";
export type { Theme, Level, PromptDef, PromptVersion } from "./themes";

export const PROMPTS: Record<PromptVersion, PromptDef> = { v1, v2 };

export const CURRENT_PROMPT: PromptDef = v2;
