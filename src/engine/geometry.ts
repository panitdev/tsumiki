/** Inclusive cell ranges. */
export type Box = [x1: number, y1: number, z1: number, x2: number, y2: number, z2: number];
export type Position = [x: number, y: number, z: number];

export function normalizeBox(box: Box): Box {
  const [x1, y1, z1, x2, y2, z2] = box;
  return [Math.min(x1, x2), Math.min(y1, y2), Math.min(z1, z2),
    Math.max(x1, x2), Math.max(y1, y2), Math.max(z1, z2)];
}

export function unionBox(a: Box | null, b: Box | null): Box | null {
  if (!a) return b && ([...b] as Box);
  if (!b) return a;
  a[0] = Math.min(a[0], b[0]);
  a[1] = Math.min(a[1], b[1]);
  a[2] = Math.min(a[2], b[2]);
  a[3] = Math.max(a[3], b[3]);
  a[4] = Math.max(a[4], b[4]);
  a[5] = Math.max(a[5], b[5]);
  return a;
}
