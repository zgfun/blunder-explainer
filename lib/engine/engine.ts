import type { EngineLine } from "@/lib/chess/types";
import { terminalLine } from "./terminal";
import { UciAccumulator } from "./uci";

export const DEFAULT_ENGINE_URL = "/engine/stockfish-19-lite-single.js";

function abortError(): Error {
  const err = new Error("Analysis cancelled");
  err.name = "AbortError";
  return err;
}

/** Browser Stockfish wrapper: one Web Worker, one "go" at a time. */
export class Engine {
  private worker: Worker | null = null;
  private listeners = new Set<(line: string) => void>();
  private initPromise: Promise<void> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private terminated = false;
  private pending = new Set<(err: Error) => void>();

  constructor(private workerUrl = DEFAULT_ENGINE_URL) {}

  init(): Promise<void> {
    this.initPromise ??= (async () => {
      if (typeof Worker === "undefined") throw new Error("Web Workers are not available here");
      const worker = new Worker(this.workerUrl);
      this.worker = worker;
      worker.onmessage = (e: MessageEvent) => {
        const data = typeof e.data === "string" ? e.data : String(e.data ?? "");
        for (const line of data.split("\n")) {
          if (line) for (const l of [...this.listeners]) l(line);
        }
      };
      const failed = new Promise<never>((_, reject) => {
        worker.onerror = (e) => reject(new Error(`Stockfish failed to load: ${e.message ?? "unknown error"}`));
      });
      const handshake = (async () => {
        this.send("uci");
        await this.waitFor((l) => l === "uciok");
        this.send("setoption name Hash value 32");
        this.send("isready");
        await this.waitFor((l) => l === "readyok");
      })();
      await Promise.race([handshake, failed]);
    })();
    return this.initPromise;
  }

  private send(cmd: string) {
    if (this.terminated || !this.worker) throw new Error("Engine is not running");
    this.worker.postMessage(cmd);
  }

  private waitFor(match: (line: string) => boolean): Promise<string> {
    return new Promise((resolve) => {
      const l = (line: string) => {
        if (match(line)) {
          this.listeners.delete(l);
          resolve(line);
        }
      };
      this.listeners.add(l);
    });
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private runGo(fen: string, depth: number, signal?: AbortSignal): Promise<EngineLine> {
    return new Promise<EngineLine>((resolve, reject) => {
      if (signal?.aborted) return reject(abortError());
      const acc = new UciAccumulator();
      let aborted = false;
      const onAbort = () => {
        aborted = true;
        // Wait for the engine's bestmove after "stop" so the next search starts clean.
        try {
          this.send("stop");
        } catch {
          cleanup();
          reject(abortError());
        }
      };
      const listener = (line: string) => {
        const done = acc.push(line);
        if (!done) return;
        cleanup();
        if (aborted) reject(abortError());
        else resolve(done);
      };
      const fail = (err: Error) => {
        cleanup();
        reject(err);
      };
      const cleanup = () => {
        this.pending.delete(fail);
        this.listeners.delete(listener);
        signal?.removeEventListener("abort", onAbort);
      };
      this.listeners.add(listener);
      this.pending.add(fail);
      signal?.addEventListener("abort", onAbort, { once: true });
      this.send(`position fen ${fen}`);
      this.send(`go depth ${depth}`);
    });
  }

  async analyse(fen: string, opts: { depth?: number; signal?: AbortSignal } = {}): Promise<EngineLine> {
    const terminal = terminalLine(fen);
    if (terminal) return terminal;
    await this.init();
    return this.enqueue(() => this.runGo(fen, opts.depth ?? 16, opts.signal));
  }

  async analyseAll(
    fens: string[],
    opts: { depth?: number; onProgress?: (done: number, total: number) => void; signal?: AbortSignal } = {},
  ): Promise<EngineLine[]> {
    await this.init();
    return this.enqueue(async () => {
      this.send("ucinewgame");
      this.send("isready");
      await this.waitFor((l) => l === "readyok");
      const out: EngineLine[] = [];
      opts.onProgress?.(0, fens.length);
      for (const fen of fens) {
        if (opts.signal?.aborted) throw abortError();
        const line = terminalLine(fen) ?? (await this.runGo(fen, opts.depth ?? 16, opts.signal));
        out.push(line);
        opts.onProgress?.(out.length, fens.length);
      }
      return out;
    });
  }

  terminate(): void {
    this.terminated = true;
    for (const fail of [...this.pending]) fail(abortError());
    this.listeners.clear();
    this.worker?.terminate();
    this.worker = null;
  }
}
