export type Position = [x: number, y: number, z: number];
export type Box = [x1: number, y1: number, z1: number, x2: number, y2: number, z2: number];
export type Blocks = Map<string, string>;

export interface BlockChange {
  x: number;
  y: number;
  z: number;
  before: string;
  after: string;
}

export function blockKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

export function coordinates(key: string): Position {
  const x = key.indexOf(",");
  const y = key.indexOf(",", x + 1);
  return [Number(key.slice(0, x)), Number(key.slice(x + 1, y)), Number(key.slice(y + 1))];
}

export function normalizeBox(box: Box): Box {
  const [x1, y1, z1, x2, y2, z2] = box;
  return [Math.min(x1, x2), Math.min(y1, y2), Math.min(z1, z2),
    Math.max(x1, x2), Math.max(y1, y2), Math.max(z1, z2)];
}

function extendBox(bounds: Box, x: number, y: number, z: number): void {
  bounds[0] = Math.min(bounds[0], x);
  bounds[1] = Math.min(bounds[1], y);
  bounds[2] = Math.min(bounds[2], z);
  bounds[3] = Math.max(bounds[3], x);
  bounds[4] = Math.max(bounds[4], y);
  bounds[5] = Math.max(bounds[5], z);
}

export function getBounds(blocks: ReadonlyMap<string, string>): Box | null {
  let bounds: Box | null = null;
  for (const key of blocks.keys()) {
    const [x, y, z] = coordinates(key);
    if (bounds) extendBox(bounds, x, y, z);
    else bounds = [x, y, z, x, y, z];
  }
  return bounds;
}

export interface FloatingGroup {
  bounds: Box;
  blockCount: number;
}

const neighbors: readonly Position[] = [
  [-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1],
];

export function floatingGroups(blocks: ReadonlyMap<string, string>, bounds: Box | null, limit: number):
  { groups: FloatingGroup[]; count: number } {
  const groups: FloatingGroup[] = [];
  let count = 0;
  if (!bounds || bounds[1] === bounds[4]) return { groups, count };

  const ground = bounds[1];
  const remaining = new Set(blocks.keys());
  let frontier: string[] = [];
  let next: string[] = [];
  for (const key of remaining) {
    remaining.delete(key);
    frontier.push(key);
    const [x0, y0, z0] = coordinates(key);
    const component: Box = [x0, y0, z0, x0, y0, z0];
    let grounded = y0 === ground;
    let blockCount = 0;
    while (frontier.length) {
      blockCount += frontier.length;
      for (const current of frontier) {
        const [x, y, z] = coordinates(current);
        grounded ||= y === ground;
        if (!grounded) extendBox(component, x, y, z);
        for (const [dx, dy, dz] of neighbors) {
          const candidate = blockKey(x + dx, y + dy, z + dz);
          if (remaining.delete(candidate)) next.push(candidate);
        }
      }
      frontier.length = 0;
      [frontier, next] = [next, frontier];
    }
    if (!grounded) {
      count++;
      if (groups.length < limit) groups.push({ bounds: component, blockCount });
    }
  }
  return { groups, count };
}
