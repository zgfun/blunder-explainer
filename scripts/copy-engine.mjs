// Copies the single-threaded lite Stockfish build into public/ so the Web Worker can load it.
// Single-threaded: no SharedArrayBuffer, so no COOP/COEP headers needed.
import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync("public/engine", { recursive: true });
for (const ext of ["js", "wasm"]) {
  copyFileSync(
    `node_modules/stockfish/bin/stockfish-19-lite-single.${ext}`,
    `public/engine/stockfish-19-lite-single.${ext}`,
  );
}
