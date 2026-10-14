/**
 * @fileoverview Measures how a text scanner's CPU time grows with input size, for the worst-case
 * timing tests of scanners that run over upstream- or caller-sized text.
 * @module tests/helpers/cpu-scaling
 */

/** CPU milliseconds this thread has used since `since`. */
function cpuMsSince(since: NodeJS.CpuUsage): number {
  const used = process.threadCpuUsage(since);
  return (used.user + used.system) / 1000;
}

/** Thread CPU per call of `run`, repeating it until the sample has used about 20 ms of CPU. */
function sampleMs(run: () => void): number {
  const start = process.threadCpuUsage();
  let calls = 0;
  let used = 0;
  do {
    run();
    calls++;
    used = cpuMsSince(start);
  } while (used < 20);
  return used / calls;
}

/** `unit` repeated and cut to exactly `length` characters. */
export function repeatTo(unit: string, length: number): string {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
}

export const SMALL_INPUT = 5_000;
export const LARGE_INPUT = 320_000;

/**
 * Thread-CPU time of `scan` over a 5k-character and a 320k-character input built by `make` (a 64×
 * span), each the fastest of `rounds` samples, small and large rounds alternating. A linear scan
 * grows about 64× across the span, a quadratic one about 4096×.
 */
export function cpuScaling(
  scan: (text: string) => unknown,
  make: (length: number) => string,
  rounds = 3,
): { smallMs: number; largeMs: number; ratio: number } {
  const small = make(SMALL_INPUT);
  const large = make(LARGE_INPUT);
  let smallMs = Number.POSITIVE_INFINITY;
  let largeMs = Number.POSITIVE_INFINITY;
  for (let round = 0; round < rounds; round++) {
    smallMs = Math.min(
      smallMs,
      sampleMs(() => scan(small)),
    );
    largeMs = Math.min(
      largeMs,
      sampleMs(() => scan(large)),
    );
  }
  return { smallMs, largeMs, ratio: largeMs / smallMs };
}
