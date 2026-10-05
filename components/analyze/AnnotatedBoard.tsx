"use client";

import { Box } from "@chakra-ui/react";
import type { CSSProperties } from "react";
import { Board, type Arrow } from "@/components/chess/Board";

const FILES = "abcdefgh";
const noop = () => {};
const never = () => false;

export const ARROW_PLAYED = "#e5484d";
export const ARROW_BEST = "#30a46c";

function center(square: string, orientation: "white" | "black") {
  const f = FILES.indexOf(square[0]);
  const r = Number(square[1]) - 1;
  const col = orientation === "white" ? f : 7 - f;
  const row = orientation === "white" ? 7 - r : r;
  return { x: col + 0.5, y: row + 0.5 };
}

export function tint(color: string, alpha: number): CSSProperties {
  const hex = color.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return { boxShadow: `inset 0 0 0 999px rgba(${r}, ${g}, ${b}, ${alpha})` };
}

// The shared Board only draws arrows the user right-drags, so engine arrows are an overlay here.
export function AnnotatedBoard({
  fen,
  orientation,
  arrows,
  highlights = {},
  label,
}: {
  fen: string;
  orientation: "white" | "black";
  arrows: Arrow[];
  highlights?: Record<string, CSSProperties>;
  label?: string;
}) {
  return (
    <Box position="relative" w="100%" borderRadius="md" overflow="hidden" boxShadow="md" role="img" aria-label={label}>
      <Board
        fen={fen}
        orientation={orientation}
        highlights={highlights}
        canDrag={never}
        onDragStart={noop}
        onDragCancel={noop}
        onDrop={never}
        onSquareClick={noop}
        disabled
      />
      <svg viewBox="0 0 8 8" width="100%" height="100%" style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 31 }}>
        {arrows.map((a, i) => {
          if (!/^[a-h][1-8]$/.test(a.from) || !/^[a-h][1-8]$/.test(a.to) || a.from === a.to) return null;
          const s = center(a.from, orientation);
          const e = center(a.to, orientation);
          const dx = e.x - s.x, dy = e.y - s.y, len = Math.hypot(dx, dy);
          const ux = dx / len, uy = dy / len;
          const head = 0.38;
          const sx = s.x + ux * 0.25, sy = s.y + uy * 0.25;
          const ex = e.x - ux * head, ey = e.y - uy * head;
          const px = -uy, py = ux;
          return (
            <g key={`${a.from}${a.to}${i}`} fill={a.color} opacity={0.88}>
              <line x1={sx} y1={sy} x2={ex} y2={ey} stroke={a.color} strokeWidth={0.19} strokeLinecap="round" />
              <polygon points={`${e.x - ux * 0.08},${e.y - uy * 0.08} ${ex + px * 0.32},${ey + py * 0.32} ${ex - px * 0.32},${ey - py * 0.32}`} />
            </g>
          );
        })}
      </svg>
    </Box>
  );
}
