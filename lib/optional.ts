/**
 * Runs optional work (a cache read or write) with a time budget. Resolves to undefined if it
 * throws or is too slow, so an unreachable database never fails or stalls a request.
 */
export async function optional<T>(fn: () => Promise<T>, ms: number, label?: string): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(fn),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => {
          if (label) console.warn(`[${label}] skipped: no answer within ${ms} ms`);
          resolve(undefined);
        }, ms);
      }),
    ]);
  } catch (err) {
    if (label) console.warn(`[${label}] skipped:`, err instanceof Error ? err.message : err);
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
