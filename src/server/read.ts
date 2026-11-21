import { blockKey, type Box } from "../engine";
import { blockEntries, ToolError } from "./store";

export function materials(blocks: ReadonlyMap<string, string>, box?: Box) {
  const counts = new Map<string, number>();
  for (const { x, y, z, state } of blockEntries(blocks)) {
    if (box && (x < box[0] || y < box[1] || z < box[2] || x > box[3] || y > box[4] || z > box[5])) continue;
    const id = state.split("[", 1)[0];
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return Array.from(counts, ([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
}

export function readLayers(blocks: ReadonlyMap<string, string>, bounds: Box | null, y?: number | [number, number]) {
  if (!bounds) return [];
  const [minX, minY, minZ, maxX, maxY, maxZ] = bounds;
  const [first, last] = y === undefined ? [minY, maxY] : typeof y === "number" ? [y, y] : y;
  if (last < first) throw new ToolError("The Y range is reversed.", "Use [lowest Y, highest Y].");
  const start = Math.max(minY, first);
  const end = Math.min(maxY, last);
  if (end < start) return [];
  if ((maxX - minX + 1) * (maxZ - minZ + 1) * (end - start + 1) > 32_768) {
    throw new ToolError("The text grid is too large.", "Narrow box or y, or set counts to true.");
  }
  const layers = [];
  const symbols = "#ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let layer = start; layer <= end; layer++) {
    const states = new Map([["air", "."]]);
    const rows = [];
    for (let z = minZ; z <= maxZ; z++) {
      const row = [];
      for (let x = minX; x <= maxX; x++) {
        const state = blocks.get(blockKey(x, layer, z)) ?? "air";
        if (!states.has(state)) states.set(state, symbols[states.size - 1] ?? `{${states.size}}`);
        row.push(states.get(state));
      }
      rows.push(row.join(""));
    }
    const legend = Object.fromEntries(Array.from(states, ([state, symbol]) => [symbol, state]));
    const grid = [`y=${layer}   ${Object.entries(legend).map(([symbol, state]) => `${symbol} ${state}`).join("   ")}`, ...rows].join("\n");
    layers.push({ y: layer, legend, grid });
  }
  return layers;
}
