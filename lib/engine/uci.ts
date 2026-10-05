import type { EngineLine, Score } from "@/lib/chess/types";

export type InfoLine = {
  depth: number;
  multipv: number;
  score: Score;
  pv: string[];
  bound?: "lower" | "upper";
};

export function parseInfoLine(line: string): InfoLine | null {
  const tokens = line.trim().split(/\s+/);
  if (tokens[0] !== "info") return null;
  let depth: number | null = null;
  let multipv = 1;
  let score: Score | null = null;
  let bound: "lower" | "upper" | undefined;
  let pv: string[] = [];
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === "depth") {
      depth = Number(tokens[++i]);
    } else if (t === "multipv") {
      multipv = Number(tokens[++i]);
    } else if (t === "score") {
      const kind = tokens[++i];
      const value = Number(tokens[++i]);
      if (kind === "cp") score = { cp: value };
      else if (kind === "mate") score = { mate: value };
      const next = tokens[i + 1];
      if (next === "lowerbound" || next === "upperbound") {
        bound = next === "lowerbound" ? "lower" : "upper";
        i++;
      }
    } else if (t === "pv") {
      pv = tokens.slice(i + 1);
      break;
    } else if (t === "string") {
      return null;
    }
  }
  if (depth === null || !Number.isFinite(depth) || !score) return null;
  if ("cp" in score && !Number.isFinite(score.cp)) return null;
  if ("mate" in score && !Number.isFinite(score.mate)) return null;
  return { depth, multipv, score, pv, bound };
}

export function parseBestMove(line: string): string | null {
  const m = /^bestmove\s+(\S+)/.exec(line.trim());
  if (!m) return null;
  return m[1] === "(none)" ? "" : m[1];
}

/** Accumulates engine output for a single "go" and yields the final EngineLine. */
export class UciAccumulator {
  private best: InfoLine | null = null;

  /** Returns the finished EngineLine when "bestmove" arrives, otherwise null. */
  push(line: string): EngineLine | null {
    const info = parseInfoLine(line);
    if (info) {
      // Bound scores come from aspiration-window fail highs/lows; only trust exact ones
      // unless that's all we have at this depth.
      if (info.multipv !== 1 || info.pv.length === 0) return null;
      const cur = this.best;
      if (!cur || info.depth > cur.depth || (info.depth === cur.depth && (!info.bound || cur.bound))) {
        this.best = info;
      }
      return null;
    }
    const bestmove = parseBestMove(line);
    if (bestmove === null) return null;
    const b = this.best;
    const bestUci = bestmove || b?.pv[0] || "";
    const pvUci = b && b.pv[0] === bestUci ? b.pv : bestUci ? [bestUci] : [];
    return {
      depth: b?.depth ?? 0,
      score: b?.score ?? { cp: 0 },
      bestUci,
      pvUci,
    };
  }

  reset() {
    this.best = null;
  }
}
