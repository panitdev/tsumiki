import { createHash } from "node:crypto";

/** Mulberry32, seeded from the group path. The n-th value depends only on the path and n. */
export function groupRandom(path: string): () => number {
  let state = createHash("sha256").update(path).digest().readUInt32LE(0);
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let result = Math.imul(state ^ (state >>> 15), state | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 0x100000000;
  };
}
