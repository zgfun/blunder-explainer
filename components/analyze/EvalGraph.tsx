"use client";

import { Box, Text, chakra } from "@chakra-ui/react";
import { useState, type PointerEvent } from "react";
import { formatPawns } from "./format";

export type GraphMarker = { index: number; color: string; label: string; targetId?: string };

const W = 600;
const H = 140;
const CLAMP = 10;

function y(p: number) {
  const v = Math.max(-CLAMP, Math.min(CLAMP, p));
  return H / 2 - (v / CLAMP) * (H / 2 - 4);
}

/** evals[i] = white-perspective pawns of the position after i plies; moveLabels[i] names the move that led there. */
export function EvalGraph({ evals, moveLabels, markers }: { evals: number[]; moveLabels: string[]; markers: GraphMarker[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const n = evals.length;
  if (n < 2) return null;
  const x = (i: number) => (i / (n - 1)) * W;
  const pts = evals.map((p, i) => `${x(i).toFixed(2)},${y(p).toFixed(2)}`).join(" L");
  const area = `M0,${H} L${pts} L${W},${H} Z`;
  const line = `M${pts}`;

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left) / r.width) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };

  const pct = (i: number) => `${(i / (n - 1)) * 100}%`;
  const hoverLeft = hover !== null ? (hover / (n - 1)) * 100 : 0;

  return (
    <Box
      position="relative"
      w="100%"
      h={{ base: "110px", md: "140px" }}
      borderRadius="md"
      overflow="visible"
      onPointerMove={onMove}
      onPointerLeave={() => setHover(null)}
      style={{ touchAction: "pan-y" }}
    >
      <Box position="absolute" inset="0" borderRadius="md" overflow="hidden" borderWidth="1px" borderColor="border">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height="100%" role="img" aria-label="Evaluation graph over the game, from White's perspective">
          <rect x="0" y="0" width={W} height={H} fill="#34342f" />
          <path d={area} fill="#ecebe4" />
          <line x1="0" x2={W} y1={H / 2} y2={H / 2} stroke="#8a8a85" strokeWidth="1" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
          <path d={line} fill="none" stroke="#9a9a92" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          {markers.map((m) => (
            <line key={`l${m.index}`} x1={x(m.index)} x2={x(m.index)} y1="0" y2={H} stroke={m.color} strokeOpacity="0.55" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
      </Box>

      {markers.map((m) => (
        <chakra.button
          key={`m${m.index}`}
          type="button"
          position="absolute"
          left={pct(m.index)}
          top={`${(y(evals[m.index]) / H) * 100}%`}
          transform="translate(-50%, -50%)"
          boxSize="3.5"
          borderRadius="full"
          bg={m.color}
          borderWidth="2px"
          borderColor="white"
          boxShadow="sm"
          cursor="pointer"
          zIndex="1"
          aria-label={`Jump to ${m.label}`}
          title={m.label}
          onClick={() => {
            if (m.targetId) document.getElementById(m.targetId)?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
          _hover={{ transform: "translate(-50%, -50%) scale(1.25)" }}
          transition="transform 0.15s"
        />
      ))}

      {hover !== null && (
        <>
          <Box position="absolute" top="0" bottom="0" left={pct(hover)} w="1px" bg="fg.muted" pointerEvents="none" />
          <Box
            position="absolute"
            top="-2"
            left={hoverLeft > 70 ? "auto" : `calc(${hoverLeft}% + 8px)`}
            right={hoverLeft > 70 ? `calc(${100 - hoverLeft}% + 8px)` : "auto"}
            transform="translateY(-100%)"
            bg="bg.panel"
            borderWidth="1px"
            borderColor="border"
            borderRadius="sm"
            px="2"
            py="1"
            boxShadow="sm"
            pointerEvents="none"
            whiteSpace="nowrap"
            zIndex="2"
          >
            <Text fontSize="xs" fontFamily="mono">
              {moveLabels[hover] || "Start"} · {formatPawns(evals[hover])}
            </Text>
          </Box>
        </>
      )}
    </Box>
  );
}
