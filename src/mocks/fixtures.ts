import type { RenderAssetData, RenderBlock } from "../render/shared";
import type { StructureSnapshot, StructureSummary } from "../viewer/data";

export const structureSummaries: StructureSummary[] = [
  { name: "castle-keep", bounds: [0, 0, 0, 7, 5, 7], blockCount: 120, historyDepth: 3, version: 7 },
  { name: "windmill", bounds: [0, 0, 0, 5, 11, 5], blockCount: 64, historyDepth: 1, version: 12 },
  { name: "empty-canvas", bounds: null, blockCount: 0, historyDepth: 0, version: 1 },
];

function box(size: [number, number, number]): StructureSnapshot["bounds"] {
  const [w, h, d] = size;
  return [0, 0, 0, w - 1, h - 1, d - 1];
}

const castleWalls: RenderBlock[] = [];
for (let x = 0; x <= 7; x++) {
  for (let z = 0; z <= 7; z++) {
    castleWalls.push({ x, y: 0, z, state: "minecraft:stone" });
    if (x === 0 || x === 7 || z === 0 || z === 7) {
      for (let y = 1; y <= 4; y++) {
        castleWalls.push({ x, y, z, state: y === 4 ? "minecraft:oak_planks" : "minecraft:dirt" });
      }
    }
  }
}

const snapshots: Record<string, StructureSnapshot> = {
  "castle-keep": {
    name: "castle-keep",
    bounds: box([8, 5, 8]),
    blockCount: castleWalls.length,
    historyDepth: 3,
    version: 7,
    blocks: castleWalls,
  },
  "windmill": {
    name: "windmill",
    bounds: [0, 0, 0, 2, 5, 2],
    blockCount: 18,
    historyDepth: 1,
    version: 12,
    blocks: [
      { x: 1, y: 0, z: 1, state: "minecraft:stone" },
      { x: 1, y: 1, z: 1, state: "minecraft:dirt" },
      { x: 1, y: 2, z: 1, state: "minecraft:oak_planks" },
      { x: 0, y: 1, z: 1, state: "minecraft:oak_planks" },
      { x: 2, y: 1, z: 1, state: "minecraft:oak_planks" },
      { x: 1, y: 1, z: 0, state: "minecraft:oak_planks" },
      { x: 1, y: 1, z: 2, state: "minecraft:oak_planks" },
    ],
  },
  "empty-canvas": {
    name: "empty-canvas",
    bounds: null,
    blockCount: 0,
    historyDepth: 0,
    version: 1,
    blocks: [],
  },
};

export function findSnapshot(name: string, undo: number): StructureSnapshot | null {
  const snapshot = snapshots[name];
  if (!snapshot) return null;
  if (!undo) return snapshot;
  // Mock history: earlier steps drop the newest blocks (highest y first).
  const steps = Math.min(undo, snapshot.historyDepth);
  const sorted = [...snapshot.blocks].sort((a, b) => b.y - a.y || b.z - a.z || b.x - a.x);
  const blocks = sorted.slice(steps * 8).map(block => ({ ...block }));
  return {
    ...snapshot,
    version: snapshot.version,
    blocks,
    blockCount: blocks.length,
    bounds: blocks.length ? [0, 0, 0, 7, 4, 7] : null,
  };
}

export function assetManifest(): RenderAssetData {
  const cube: Record<string, unknown> = {
    textures: { particle: "#all" },
    elements: [{
      from: [0, 0, 0],
      to: [16, 16, 16],
      faces: Object.fromEntries(["down", "up", "north", "south", "east", "west"].map(face => [face, { texture: "#all" }])),
    }],
  };
  const textures: RenderAssetData["textures"] = {
    "minecraft:block/stone": [16 / 64, 0, 32 / 64, 16 / 64],
    "minecraft:block/dirt": [32 / 64, 0, 48 / 64, 16 / 64],
    "minecraft:block/oak_planks": [48 / 64, 0, 64 / 64, 16 / 64],
  };
  return {
    version: "1.21-mock",
    blockstates: {
      "minecraft:stone": { variants: { "": { model: "minecraft:block/stone" } } },
      "minecraft:dirt": { variants: { "": { model: "minecraft:block/dirt" } } },
      "minecraft:oak_planks": { variants: { "": { model: "minecraft:block/oak_planks" } } },
    },
    models: {
      "minecraft:block/cube": cube,
      "minecraft:block/stone": { parent: "minecraft:block/cube", textures: { all: "minecraft:block/stone" } },
      "minecraft:block/dirt": { parent: "minecraft:block/cube", textures: { all: "minecraft:block/dirt" } },
      "minecraft:block/oak_planks": { parent: "minecraft:block/cube", textures: { all: "minecraft:block/oak_planks" } },
    },
    textures,
    flags: {
      "minecraft:stone": { opaque: true },
      "minecraft:dirt": { opaque: true },
      "minecraft:oak_planks": { opaque: true },
    },
    defaults: {},
  };
}

/** Structures that "exist" but fail, to exercise error states in stories. */
export const failingStructures = new Set(["broken-structure"]);
