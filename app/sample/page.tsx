import type { Metadata } from "next";
import { SampleClient } from "@/components/analyze/SampleClient";
import type { EngineLine } from "@/lib/chess/types";
import { SAMPLE_GAME } from "@/lib/sample";
import sampleData from "@/lib/sample-data.json";

export const metadata: Metadata = {
  title: "Sample game · Blunder Explainer",
  description: "A real chess.com game with its three worst moves found by Stockfish and explained by Claude.",
};

export default function SamplePage() {
  const lines = (sampleData as unknown as { lines?: EngineLine[] }).lines;
  return (
    <SampleClient
      game={{ id: SAMPLE_GAME.id, url: SAMPLE_GAME.url, pgn: SAMPLE_GAME.pgn, white: SAMPLE_GAME.white, black: SAMPLE_GAME.black }}
      note={SAMPLE_GAME.note}
      lines={lines}
    />
  );
}
