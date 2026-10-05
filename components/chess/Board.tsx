"use client";

import { Box, Text } from "@chakra-ui/react";
import { animate, motion, useMotionValue, useReducedMotion } from "framer-motion";
import { defaultPieces } from "react-chessboard";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

// A small chessboard with hand-rolled pointer dragging (no drag library, no
// fixed-position overlays), tap-to-move, and right-drag arrows.

export type PieceCode = string; // "wP", "bK", ...
export type Arrow = { from: string; to: string; color: string };

const FILES = "abcdefgh";

export function positionsFromFen(fen: string): Record<string, PieceCode> {
  const out: Record<string, PieceCode> = {};
  const rows = fen.split(" ")[0].split("/");
  rows.forEach((row, r) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) f += Number(ch);
      else {
        out[FILES[f] + (8 - r)] = (ch === ch.toUpperCase() ? "w" : "b") + ch.toUpperCase();
        f++;
      }
    }
  });
  return out;
}

type Tracked = { id: number; type: PieceCode };
let nextId = 1;
function dist(a: string, b: string) {
  return Math.hypot(a.charCodeAt(0) - b.charCodeAt(0), Number(a[1]) - Number(b[1]));
}
// Keep stable ids across moves so a piece glides instead of teleporting.
function assignIds(prev: Map<string, Tracked>, next: Record<string, PieceCode>) {
  const result = new Map<string, Tracked>();
  const removed = new Map<PieceCode, string[]>();
  const added = new Map<PieceCode, string[]>();
  for (const [sq, t] of prev) {
    if (next[sq] === t.type) result.set(sq, t);
    else removed.set(t.type, [...(removed.get(t.type) ?? []), sq]);
  }
  for (const sq of Object.keys(next)) {
    if (!result.has(sq)) added.set(next[sq], [...(added.get(next[sq]) ?? []), sq]);
  }
  for (const [type, squares] of added) {
    const pool = removed.get(type) ?? [];
    for (const sq of squares) {
      if (pool.length) {
        pool.sort((a, b) => dist(a, sq) - dist(b, sq));
        const from = pool.shift() as string;
        result.set(sq, { id: prev.get(from)!.id, type });
      } else {
        result.set(sq, { id: nextId++, type });
      }
    }
  }
  return result;
}

const ARROW_COLORS = { default: "#c6ff00", shift: "#ff3b30", ctrl: "#4da3ff", alt: "#ffb02e" };

export function Board({
  fen,
  orientation,
  highlights,
  canDrag,
  onDragStart,
  onDragCancel,
  onDrop,
  onSquareClick,
  disabled,
}: {
  fen: string;
  orientation: "white" | "black";
  highlights: Record<string, React.CSSProperties>;
  canDrag: (square: string, piece: PieceCode) => boolean;
  onDragStart: (square: string) => void;
  onDragCancel: () => void;
  onDrop: (from: string, to: string) => boolean;
  onSquareClick: (square: string, piece: PieceCode | null) => void;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(0);
  const sq = size / 8;
  const [arrows, setArrows] = useState<Arrow[]>([]);
  const [preview, setPreview] = useState<Arrow | null>(null);
  const rightDrag = useRef<{ from: string; color: string } | null>(null);
  const reduce = useReducedMotion();

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize(e.contentRect.width));
    ro.observe(el);
    setSize(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const positions = useMemo(() => positionsFromFen(fen), [fen]);
  // Derived state: re-pair piece ids whenever the position changes.
  const [track, setTrack] = useState(() => ({ fen, map: assignIds(new Map<string, Tracked>(), positions) }));
  if (track.fen !== fen) {
    setTrack({ fen, map: assignIds(track.map, positions) });
  }
  const tracked = track.map;

  // square <-> pixel helpers
  const toXY = (square: string) => {
    const f = FILES.indexOf(square[0]);
    const r = Number(square[1]) - 1;
    const col = orientation === "white" ? f : 7 - f;
    const row = orientation === "white" ? 7 - r : r;
    return { x: col * sq, y: row * sq };
  };
  const toSquare = (px: number, py: number) => {
    const col = Math.floor(px / sq);
    const row = Math.floor(py / sq);
    if (col < 0 || col > 7 || row < 0 || row > 7) return null;
    const f = orientation === "white" ? col : 7 - col;
    const r = orientation === "white" ? 7 - row : row;
    return FILES[f] + (r + 1);
  };
  const rel = (e: React.PointerEvent | PointerEvent) => {
    const b = ref.current!.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  };

  // Right-drag arrows
  const onBoardPointerDown = (e: React.PointerEvent) => {
    if (e.button === 2) {
      e.preventDefault();
      const p = rel(e);
      const s = toSquare(p.x, p.y);
      if (!s) return;
      const color = e.shiftKey ? ARROW_COLORS.shift : e.ctrlKey || e.metaKey ? ARROW_COLORS.ctrl : e.altKey ? ARROW_COLORS.alt : ARROW_COLORS.default;
      rightDrag.current = { from: s, color };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } else if (e.button === 0) {
      setArrows([]);
    }
  };
  const onBoardPointerMove = (e: React.PointerEvent) => {
    const d = rightDrag.current;
    if (!d) return;
    const p = rel(e);
    const s = toSquare(p.x, p.y);
    setPreview(s && s !== d.from ? { from: d.from, to: s, color: d.color } : null);
  };
  const onBoardPointerUp = (e: React.PointerEvent) => {
    const d = rightDrag.current;
    if (!d) return;
    rightDrag.current = null;
    setPreview(null);
    const p = rel(e);
    const s = toSquare(p.x, p.y);
    if (!s || s === d.from) {
      setArrows([]);
      return;
    }
    setArrows((prev) => {
      const exists = prev.findIndex((a) => a.from === d.from && a.to === s);
      if (exists >= 0) return prev.filter((_, i) => i !== exists);
      return [...prev, { from: d.from, to: s, color: d.color }];
    });
  };

  const squares = useMemo(() => {
    const out: { square: string; light: boolean; col: number; row: number }[] = [];
    for (let row = 0; row < 8; row++)
      for (let col = 0; col < 8; col++) {
        const f = orientation === "white" ? col : 7 - col;
        const r = orientation === "white" ? 7 - row : row;
        out.push({ square: FILES[f] + (r + 1), light: (f + r) % 2 === 1, col, row });
      }
    return out;
  }, [orientation]);

  return (
    <Box
      ref={ref}
      position="relative"
      w="100%"
      aspectRatio="1"
      userSelect="none"
      style={{ touchAction: "none" }}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={onBoardPointerDown}
      onPointerMove={onBoardPointerMove}
      onPointerUp={onBoardPointerUp}
      onPointerCancel={onBoardPointerUp}
    >
      {/* squares */}
      {squares.map((s) => (
        <Box
          key={s.square}
          data-square={s.square}
          position="absolute"
          left={`${s.col * sq}px`}
          top={`${s.row * sq}px`}
          w={`${sq}px`}
          h={`${sq}px`}
          bg={s.light ? "#5a5a55" : "#2b2b29"}
          style={highlights[s.square]}
          onClick={() => {
            if (!disabled) onSquareClick(s.square, positions[s.square] ?? null);
          }}
          cursor={disabled ? "default" : "pointer"}
        >
          {s.col === 0 && (
            <Text position="absolute" top="2px" left="3px" fontSize={`${Math.max(9, sq * 0.17)}px`} fontFamily="mono" color={s.light ? "#1b1b1a" : "#8a8a85"} lineHeight="1">
              {s.square[1]}
            </Text>
          )}
          {s.row === 7 && (
            <Text position="absolute" bottom="2px" right="4px" fontSize={`${Math.max(9, sq * 0.17)}px`} fontFamily="mono" color={s.light ? "#1b1b1a" : "#8a8a85"} lineHeight="1">
              {s.square[0]}
            </Text>
          )}
        </Box>
      ))}

      {/* pieces */}
      {sq > 0 &&
        Array.from(tracked.entries()).map(([square, t]) => (
          <Piece
            key={t.id}
            square={square}
            type={t.type}
            size={sq}
            target={toXY(square)}
            draggable={!disabled && canDrag(square, t.type)}
            reduce={!!reduce}
            rel={rel}
            toSquare={toSquare}
            onDragStart={() => onDragStart(square)}
            onDragCancel={onDragCancel}
            onDrop={(to) => onDrop(square, to)}
            onTap={() => onSquareClick(square, t.type)}
          />
        ))}

      {/* arrows */}
      <svg viewBox="0 0 8 8" width="100%" height="100%" style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 30 }}>
        {[...arrows, ...(preview ? [preview] : [])].map((a, i) => {
          const from = toXY(a.from);
          const to = toXY(a.to);
          const x1 = from.x / sq + 0.5, y1 = from.y / sq + 0.5, x2 = to.x / sq + 0.5, y2 = to.y / sq + 0.5;
          const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
          const ux = dx / len, uy = dy / len;
          const head = 0.32;
          const sx = x1 + ux * 0.32, sy = y1 + uy * 0.32; // start a bit off-centre
          const ex = x2 - ux * head, ey = y2 - uy * head;
          const px = -uy, py = ux;
          const op = a === preview ? 0.55 : 0.85;
          return (
            <g key={i} fill={a.color} opacity={op}>
              <line x1={sx} y1={sy} x2={ex} y2={ey} stroke={a.color} strokeWidth={0.17} strokeLinecap="round" />
              <polygon points={`${x2},${y2} ${ex + px * 0.3},${ey + py * 0.3} ${ex - px * 0.3},${ey - py * 0.3}`} />
            </g>
          );
        })}
      </svg>
    </Box>
  );
}

function Piece({
  square,
  type,
  size,
  target,
  draggable,
  reduce,
  rel,
  toSquare,
  onDragStart,
  onDragCancel,
  onDrop,
  onTap,
}: {
  square: string;
  type: PieceCode;
  size: number;
  target: { x: number; y: number };
  draggable: boolean;
  reduce: boolean;
  rel: (e: React.PointerEvent) => { x: number; y: number };
  toSquare: (x: number, y: number) => string | null;
  onDragStart: () => void;
  onDragCancel: () => void;
  onDrop: (to: string) => boolean;
  onTap: () => void;
}) {
  const x = useMotionValue(target.x);
  const y = useMotionValue(target.y);
  const scale = useMotionValue(1);
  const drag = useRef<{ offX: number; offY: number; startX: number; startY: number; moved: boolean } | null>(null);
  const [held, setHeld] = useState(false);
  const render = defaultPieces[type];

  useEffect(() => {
    if (drag.current) return;
    const t = reduce ? { duration: 0 } : { duration: 0.18, ease: [0.22, 1, 0.36, 1] as const };
    const a = animate(x, target.x, t);
    const b = animate(y, target.y, t);
    return () => {
      a.stop();
      b.stop();
    };
  }, [target.x, target.y, x, y, reduce, held]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return; // right button is for arrows, let it bubble
    e.stopPropagation();
    if (!draggable) {
      onTap();
      return;
    }
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const p = rel(e);
    drag.current = { offX: p.x - x.get(), offY: p.y - y.get(), startX: p.x, startY: p.y, moved: false };
    setHeld(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = rel(e);
    if (!d.moved && Math.hypot(p.x - d.startX, p.y - d.startY) > 3) {
      d.moved = true;
      onDragStart();
      animate(scale, 1.12, { duration: 0.12 });
    }
    if (d.moved) {
      x.set(p.x - d.offX);
      y.set(p.y - d.offY);
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    animate(scale, 1, { duration: 0.12 });
    const p = rel(e);
    if (d.moved) {
      const to = toSquare(p.x, p.y);
      const ok = to && to !== square ? onDrop(to) : false;
      if (!ok) {
        onDragCancel();
        animate(x, target.x, { type: "spring", stiffness: 500, damping: 36 });
        animate(y, target.y, { type: "spring", stiffness: 500, damping: 36 });
      }
    } else {
      onTap();
    }
    setHeld(false);
  };

  return (
    <motion.div
      data-piece={type}
      data-piece-square={square}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: size,
        height: size,
        x,
        y,
        scale,
        zIndex: held ? 20 : 10,
        cursor: draggable ? (held ? "grabbing" : "grab") : "default",
        touchAction: "none",
        filter: held ? "drop-shadow(0 10px 14px rgba(0,0,0,.55))" : "drop-shadow(0 1px 1px rgba(0,0,0,.4))",
        willChange: "transform",
      }}
    >
      {render ? render({ svgStyle: { width: "100%", height: "100%", display: "block" } }) : null}
    </motion.div>
  );
}
