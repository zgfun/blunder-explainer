import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { createInterface } from "node:readline";
import type { EngineLine } from "@/lib/chess/types";
import { positionCommand, terminalLine, terminalLineForGame, type GameHistory } from "./terminal";
import { UciAccumulator } from "./uci";

const ANALYSE_TIMEOUT_MS = 120_000;

type Waiter = { match: (line: string) => boolean; resolve: (line: string) => void };

class NodeEngine {
  private proc: ChildProcessWithoutNullStreams;
  private waiters: Waiter[] = [];
  private onLine: ((line: string) => void) | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private ready: Promise<void>;
  private pending = 0;
  private exited = false;

  constructor() {
    const req = createRequire(path.join(process.cwd(), "package.json"));
    const script = req.resolve("stockfish/bin/stockfish-19-lite-single.js");
    // The stockfish npm build runs as a UCI CLI when executed directly; a child process keeps
    // the WASM heap out of our process and makes shutdown trivial.
    this.proc = spawn(process.execPath, [script], { stdio: ["pipe", "pipe", "pipe"] });
    this.proc.on("exit", () => {
      this.exited = true;
    });
    createInterface({ input: this.proc.stdout }).on("line", (line) => {
      this.onLine?.(line);
      const idx = this.waiters.findIndex((w) => w.match(line));
      if (idx >= 0) this.waiters.splice(idx, 1)[0].resolve(line);
    });
    this.ready = (async () => {
      this.ref();
      this.send("uci");
      await this.waitFor((l) => l === "uciok");
      this.send("setoption name Hash value 32");
      this.send("isready");
      await this.waitFor((l) => l === "readyok");
      this.unref();
    })();
  }

  private ref() {
    this.pending++;
    this.proc.ref();
    (this.proc.stdout as unknown as { ref?: () => void }).ref?.();
  }

  // Idle engine must not keep scripts alive after their work is done.
  private unref() {
    this.pending = Math.max(0, this.pending - 1);
    if (this.pending > 0) return;
    this.proc.unref();
    (this.proc.stdout as unknown as { unref?: () => void }).unref?.();
    (this.proc.stdin as unknown as { unref?: () => void }).unref?.();
    (this.proc.stderr as unknown as { unref?: () => void }).unref?.();
  }

  private send(cmd: string) {
    if (this.exited) throw new Error("Stockfish process has exited");
    this.proc.stdin.write(cmd + "\n");
  }

  private waitFor(match: (line: string) => boolean): Promise<string> {
    return new Promise((resolve) => this.waiters.push({ match, resolve }));
  }

  analyse(fen: string, depth: number, history?: GameHistory): Promise<EngineLine> {
    const run = async (): Promise<EngineLine> => {
      await this.ready;
      this.ref();
      try {
        // A fresh hash per search: single-threaded Stockfish at a fixed depth is then
        // deterministic, so the test set and sample data rebuild byte-for-byte.
        this.send("ucinewgame");
        this.send("isready");
        await this.waitFor((l) => l === "readyok");
        const acc = new UciAccumulator();
        const result = new Promise<EngineLine>((resolve, reject) => {
          const timer = setTimeout(() => {
            this.onLine = null;
            reject(new Error(`Stockfish timed out analysing ${fen}`));
          }, ANALYSE_TIMEOUT_MS);
          this.onLine = (line) => {
            const done = acc.push(line);
            if (done) {
              clearTimeout(timer);
              this.onLine = null;
              resolve(done);
            }
          };
        });
        this.send(positionCommand(fen, history));
        this.send(`go depth ${depth}`);
        return await result;
      } finally {
        this.unref();
      }
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  close() {
    if (!this.exited) {
      try {
        this.send("quit");
      } catch {
        // already gone
      }
      this.proc.kill();
    }
  }
}

let instance: NodeEngine | null = null;

/** `history` (the moves that led to `fen`) lets Stockfish and the draw check see repetitions. */
export async function analyseFenNode(fen: string, depth = 16, history?: GameHistory): Promise<EngineLine> {
  const terminal = history ? terminalLineForGame(history) : terminalLine(fen);
  if (terminal) return terminal;
  instance ??= new NodeEngine();
  return instance.analyse(fen, depth, history);
}

export function closeNodeEngine(): void {
  instance?.close();
  instance = null;
}
