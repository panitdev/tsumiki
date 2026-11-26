import type { Box } from "./geometry";

const SIZE = 16;
const VOLUME = SIZE * SIZE * SIZE;

/** A number is a chunk filled with one value, so large fills stay ranges instead of cells. */
type Chunk = Uint32Array | number;

export class WorldTooSparseError extends Error {}

/**
 * Sparse grid of non-zero integers. Zero means empty.
 */
export class World {
  private readonly chunks = new Map<string, Chunk>();
  private dense = 0;
  private lastKey = "";
  private lastX = NaN;
  private lastY = NaN;
  private lastZ = NaN;

  constructor(private readonly maxDenseChunks = 8_192) {}

  private key(cx: number, cy: number, cz: number): string {
    if (cx !== this.lastX || cy !== this.lastY || cz !== this.lastZ) {
      this.lastX = cx;
      this.lastY = cy;
      this.lastZ = cz;
      this.lastKey = `${cx},${cy},${cz}`;
    }
    return this.lastKey;
  }

  get(x: number, y: number, z: number): number {
    const chunk = this.chunks.get(this.key(x >> 4, y >> 4, z >> 4));
    if (chunk === undefined) return 0;
    return typeof chunk === "number" ? chunk : chunk[offset(x & 15, y & 15, z & 15)];
  }

  private materialize(key: string, chunk: Chunk | undefined): Uint32Array {
    if (typeof chunk === "object") return chunk;
    if (++this.dense > this.maxDenseChunks) throw new WorldTooSparseError();
    const cells = new Uint32Array(VOLUME);
    if (chunk) cells.fill(chunk);
    this.chunks.set(key, cells);
    return cells;
  }

  /** Returns the previous value. */
  set(x: number, y: number, z: number, value: number): number {
    const key = this.key(x >> 4, y >> 4, z >> 4);
    const chunk = this.chunks.get(key);
    if (chunk === undefined && !value) return 0;
    if (chunk === value) return value;
    const cells = this.materialize(key, chunk);
    const index = offset(x & 15, y & 15, z & 15);
    const previous = cells[index];
    cells[index] = value;
    return previous;
  }

  /** Reports every non-empty value that the box replaces, in runs of equal cells where cheap. */
  fill([x1, y1, z1, x2, y2, z2]: Box, value: number, replaced: (previous: number, count: number) => void,
      tick: () => void): void {
    for (let cy = y1 >> 4; cy <= y2 >> 4; cy++) {
      for (let cz = z1 >> 4; cz <= z2 >> 4; cz++) {
        for (let cx = x1 >> 4; cx <= x2 >> 4; cx++) {
          tick();
          const key = this.key(cx, cy, cz);
          const chunk = this.chunks.get(key);
          if (chunk === undefined && !value) continue;
          const lx = Math.max(x1 - cx * SIZE, 0), hx = Math.min(x2 - cx * SIZE, 15);
          const ly = Math.max(y1 - cy * SIZE, 0), hy = Math.min(y2 - cy * SIZE, 15);
          const lz = Math.max(z1 - cz * SIZE, 0), hz = Math.min(z2 - cz * SIZE, 15);
          if (hx - lx === 15 && hy - ly === 15 && hz - lz === 15) {
            if (typeof chunk === "number") replaced(chunk, VOLUME);
            else if (chunk) {
              tally(chunk, replaced);
              this.dense--;
            }
            if (value) this.chunks.set(key, value);
            else this.chunks.delete(key);
            continue;
          }
          if (chunk === value) {
            replaced(value, (hx - lx + 1) * (hy - ly + 1) * (hz - lz + 1));
            continue;
          }
          const cells = this.materialize(key, chunk);
          for (let y = ly; y <= hy; y++) {
            for (let z = lz; z <= hz; z++) {
              for (let x = lx; x <= hx; x++) {
                const index = offset(x, y, z);
                if (cells[index]) replaced(cells[index], 1);
                cells[index] = value;
              }
            }
          }
        }
      }
    }
  }

  /** Empties every cell whose value matches. */
  erase(matches: (value: number) => boolean, tick: () => void): void {
    for (const [key, chunk] of this.chunks) {
      tick();
      if (typeof chunk === "number") {
        if (matches(chunk)) this.chunks.delete(key);
        continue;
      }
      let left = false;
      for (let i = 0; i < VOLUME; i++) {
        if (!chunk[i]) continue;
        if (matches(chunk[i])) chunk[i] = 0;
        else left = true;
      }
      if (!left) {
        this.chunks.delete(key);
        this.dense--;
      }
    }
  }

  /** Visits horizontal runs along X that share a value. */
  forEachRun(visit: (x: number, y: number, z: number, length: number, value: number) => void): void {
    for (const [key, chunk] of this.chunks) {
      const [cx, cy, cz] = key.split(",").map(Number);
      for (let y = 0; y < SIZE; y++) {
        for (let z = 0; z < SIZE; z++) {
          if (typeof chunk === "number") {
            visit(cx * SIZE, cy * SIZE + y, cz * SIZE + z, SIZE, chunk);
            continue;
          }
          for (let x = 0; x < SIZE;) {
            const value = chunk[offset(x, y, z)];
            let end = x + 1;
            while (end < SIZE && chunk[offset(end, y, z)] === value) end++;
            if (value) visit(cx * SIZE + x, cy * SIZE + y, cz * SIZE + z, end - x, value);
            x = end;
          }
        }
      }
    }
  }

  forEach(visit: (x: number, y: number, z: number, value: number) => void): void {
    this.forEachRun((x, y, z, length, value) => {
      for (let i = 0; i < length; i++) visit(x + i, y, z, value);
    });
  }

  get size(): number {
    let size = 0;
    for (const chunk of this.chunks.values()) {
      if (typeof chunk === "number") size += VOLUME;
      else for (let i = 0; i < VOLUME; i++) if (chunk[i]) size++;
    }
    return size;
  }
}

function offset(x: number, y: number, z: number): number {
  return x | (z << 4) | (y << 8);
}

function tally(cells: Uint32Array, replaced: (previous: number, count: number) => void): void {
  let value = 0;
  let count = 0;
  for (let i = 0; i < VOLUME; i++) {
    if (cells[i] === value) count++;
    else {
      if (value) replaced(value, count);
      value = cells[i];
      count = 1;
    }
  }
  if (value) replaced(value, count);
}
