import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Engine } from "../engine";

type Behaviour = { silent?: boolean };

class FakeWorker {
  static last: FakeWorker | null = null;
  static behaviour: Behaviour = {};
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  sent: string[] = [];
  terminated = false;

  constructor() {
    FakeWorker.last = this;
  }

  postMessage(cmd: string) {
    this.sent.push(cmd);
    if (FakeWorker.behaviour.silent) return;
    const reply = (data: string) => queueMicrotask(() => this.onmessage?.({ data } as MessageEvent));
    if (cmd === "uci") reply("uciok");
    if (cmd === "isready") reply("readyok");
  }

  terminate() {
    this.terminated = true;
  }

  crash(message: string) {
    this.onerror?.({ message, preventDefault() {} } as ErrorEvent);
  }

  emit(data: string) {
    this.onmessage?.({ data } as MessageEvent);
  }
}

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";

beforeEach(() => {
  FakeWorker.behaviour = {};
  vi.stubGlobal("Worker", FakeWorker);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe("Engine", () => {
  it("rejects pending analysis when the worker crashes after init", async () => {
    const engine = new Engine();
    await engine.init();
    const pending = engine.analyseAll([START, AFTER_E4], { depth: 8 });
    await flush();
    await new Promise((r) => setTimeout(r, 0));
    FakeWorker.last!.crash("RuntimeError: unreachable");
    await expect(pending).rejects.toThrow(/Stockfish crashed: RuntimeError: unreachable/);
    expect(FakeWorker.last!.terminated).toBe(true);
    await expect(engine.analyse(START)).rejects.toThrow(/Stockfish crashed/);
  });

  it("times out when the handshake never completes", async () => {
    vi.useFakeTimers();
    FakeWorker.behaviour = { silent: true };
    const engine = new Engine();
    const init = engine.init();
    const assertion = expect(init).rejects.toThrow(/did not start in time/);
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
  });

  it("sends the move history when given the game", async () => {
    const engine = new Engine();
    const run = engine.analyseAll([START, AFTER_E4], { depth: 8, game: { startFen: START, moves: ["e2e4"] } });
    const w = () => FakeWorker.last!;
    for (let i = 0; i < 2; i++) {
      await vi.waitFor(() => expect(w().sent.filter((c) => c.startsWith("go")).length).toBe(i + 1));
      w().emit(`info depth 8 multipv 1 score cp ${20 - i * 40} pv ${i ? "e7e5" : "e2e4"}`);
      w().emit(`bestmove ${i ? "e7e5" : "e2e4"}`);
    }
    const lines = await run;
    expect(lines.map((l) => l.bestUci)).toEqual(["e2e4", "e7e5"]);
    const positions = w().sent.filter((c) => c.startsWith("position"));
    expect(positions).toEqual([`position fen ${START}`, `position fen ${START} moves e2e4`]);
  });
});
