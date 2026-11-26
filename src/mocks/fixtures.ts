import type { SceneData } from "../engine/scene";
import type { RenderAssetData } from "../render/shared";
import type { StructureSnapshot, StructureSummary } from "../viewer/data";

type MockBlock = [x: number, y: number, z: number, state: string, group: number];

/** One single-cell run per block keeps the fixtures readable. */
function scene(groups: SceneData["groups"], blocks: MockBlock[], instances: SceneData["instances"] = []): SceneData {
  const states = [...new Set(blocks.map((block) => block[3]))];
  return {
    groups: [{ name: "", parent: -1 }, ...groups],
    states,
    runs: blocks.flatMap(([x, y, z, state, group]) => [x, y, z, 1, states.indexOf(state), group]),
    instances,
  };
}

const castle: MockBlock[] = [];
for (let x = 0; x <= 7; x++) {
  for (let z = 0; z <= 7; z++) {
    castle.push([x, 0, z, "stone", 2]);
    if (x === 0 || x === 7 || z === 0 || z === 7) {
      for (let y = 1; y <= 4; y++) castle.push([x, y, z, y === 4 ? "oak_planks" : "dirt", y === 4 ? 3 : 2]);
    }
  }
}

function snapshot(name: string, build: SceneData, bounds: StructureSummary["bounds"], version: number,
    buildError: string | null = null): StructureSnapshot {
  return {
    name, bounds, version, buildError, build, revision: version,
    blockCount: build.runs.length / 6,
    displayCount: build.instances.reduce((sum, instance) => sum + instance.parts.length, 0),
  };
}

const snapshots: Record<string, StructureSnapshot> = {
  "castle-keep": snapshot("castle-keep", scene(
    [{ name: "Castle", parent: 0 }, { name: "Walls", parent: 1 }, { name: "Trim", parent: 1 }],
    castle,
    [{
      id: "Castle/banner-1", model: "banner", tags: ["decor"], group: 1,
      parts: [{ block: "oak_planks", matrix: [1, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 1, 0, 3, 5, 3, 1] }],
    }],
  ), [0, 0, 0, 7, 5, 7], 7),
  "windmill": snapshot("windmill", scene([], [
    [1, 0, 1, "stone", 0], [1, 1, 1, "dirt", 0], [1, 2, 1, "oak_planks", 0], [0, 1, 1, "oak_planks", 0],
    [2, 1, 1, "oak_planks", 0], [1, 1, 0, "oak_planks", 0], [1, 1, 2, "oak_planks", 0],
  ]), [0, 0, 0, 2, 2, 2], 12, '[build failed] build.js:4 unknown block "oak_plank", did you mean "oak_planks"?'),
  "empty-canvas": snapshot("empty-canvas", scene([], []), null, 1),
};

export const structureSummaries: StructureSummary[] = Object.values(snapshots).map(({ build: _, ...summary }) => summary);

export function findSnapshot(name: string): StructureSnapshot | null {
  return snapshots[name] ?? null;
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
