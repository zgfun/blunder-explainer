import type { EngineLine } from "@/lib/chess/types";
import { positionCommand, terminalLine, terminalLineForGame, type GameHistory } from "./terminal";
import { UciAccumulator } from "./uci";

export const DEFAULT_ENGINE_URL = "/engine/stockfish-19-lite-single.js";
const HANDSHAKE_TIMEOUT_MS = 15_000;

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
  private broken: Error | null = null;

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
      // Covers load failures and crashes mid-analysis (OOM, WASM traps): every waiter must fail,
      // otherwise the UI would sit on "Analysing move N" forever.
      worker.onerror = (e) => {
        e.preventDefault?.();
        this.fail(new Error(`Stockfish crashed: ${e.message || "unknown error"}`));
      };
      await this.withTimeout(async () => {
        this.send("uci");
        await this.waitFor((l) => l === "uciok");
        this.send("setoption name Hash value 32");
        this.send("isready");
        await this.waitFor((l) => l === "readyok");
      }, HANDSHAKE_TIMEOUT_MS);
    })();
    return this.initPromise;
  }

  private fail(err: Error) {
    if (this.broken || this.terminated) return;
    this.broken = err;
    for (const fail of [...this.pending]) fail(err);
    this.listeners.clear();
    this.worker?.terminate();
    this.worker = null;
  }

  private withTimeout(fn: () => Promise<void>, ms: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const done = (err?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.pending.delete(done);
        if (err) reject(err);
        else resolve();
      };
      const timer = setTimeout(() => {
        const err = new Error("Stockfish did not start in time");
        done(err);
        this.fail(err);
      }, ms);
      this.pending.add(done);
      fn().then(() => done(), (err: unknown) => done(err instanceof Error ? err : new Error(String(err))));
    });
  }

  private send(cmd: string) {
    if (this.broken) throw this.broken;
    if (this.terminated || !this.worker) throw new Error("Engine is not running");
    this.worker.postMessage(cmd);
  }

  private waitFor(match: (line: string) => boolean): Promise<string> {
    return new Promise((resolve, reject) => {
      if (this.broken) return reject(this.broken);
      const fail = (err: Error) => {
        this.listeners.delete(l);
        this.pending.delete(fail);
        reject(err);
      };
      const l = (line: string) => {
        if (match(line)) {
          this.listeners.delete(l);
          this.pending.delete(fail);
          resolve(line);
        }
      };
      this.listeners.add(l);
      this.pending.add(fail);
    });
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private runGo(fen: string, depth: number, signal?: AbortSignal, history?: GameHistory): Promise<EngineLine> {
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
      try {
        this.send(positionCommand(fen, history));
        this.send(`go depth ${depth}`);
      } catch (err) {
        fail(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  async analyse(fen: string, opts: { depth?: number; signal?: AbortSignal } = {}): Promise<EngineLine> {
    const terminal = terminalLine(fen);
    if (terminal) return terminal;
    await this.init();
    return this.enqueue(() => this.runGo(fen, opts.depth ?? 16, opts.signal));
  }

  /**
   * With `game`, fens[i] must be the position after game.moves[0..i); each search then gets the
   * move history, so Stockfish sees repetitions and a drawn final position scores 0.
   */
  async analyseAll(
    fens: string[],
    opts: {
      depth?: number;
      onProgress?: (done: number, total: number) => void;
      signal?: AbortSignal;
      game?: GameHistory;
    } = {},
  ): Promise<EngineLine[]> {
    await this.init();
    return this.enqueue(async () => {
      this.send("ucinewgame");
      this.send("isready");
      await this.waitFor((l) => l === "readyok");
      const out: EngineLine[] = [];
      opts.onProgress?.(0, fens.length);
      for (const [i, fen] of fens.entries()) {
        if (opts.signal?.aborted) throw abortError();
        const history = opts.game ? { startFen: opts.game.startFen, moves: opts.game.moves.slice(0, i) } : undefined;
        const terminal = history && i === fens.length - 1 ? terminalLineForGame(history) : terminalLine(fen);
        const line = terminal ?? (await this.runGo(fen, opts.depth ?? 16, opts.signal, history));
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
