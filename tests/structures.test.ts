import assert from "node:assert/strict";
import test from "node:test";
import { blockKey, normalizeBlock, runBuild, turnBlock } from "../src/engine";
import { materialList } from "../src/server/formats/materials";
import { readNbt, writeNbt } from "../src/server/formats/nbt";
import { targetCatalog } from "../src/server/formats/version";

test("failed builds leave their input intact and report the failing script line", async () => {
  const initial = new Map([[blockKey(0, 0, 0), "stone"]]);
  const result = await runBuild(initial, { code: "set(0,0,0,'air')\nset(1,0,0,'oak_stairs[facing=up]')" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.line, 2);
  assert.deepEqual([...initial], [["0,0,0", "stone"]]);
});

test("weighted fills repeat across seeded builds", async () => {
  const options = { code: "fill([-2,0,-2,2,0,2], 'stone_bricks*6,mossy_stone_bricks*2')", seed: 26 };
  const first = await runBuild(new Map(), options);
  const second = await runBuild(new Map(), options);
  assert(first.ok && second.ok);
  assert.deepEqual(first.changes, second.changes);
  assert.equal(first.placed, 25);
  assert.equal(new Set(first.blocks.values()).size, 2);
});

test("rotating stateful blocks updates their direction and connectivity", () => {
  assert.equal(turnBlock("oak_stairs[facing=north]", { rotate: 90 }), "oak_stairs[facing=east]");
  assert.equal(turnBlock("oak_log[axis=x]", { rotate: 90 }), "oak_log[axis=z]");
  assert.equal(turnBlock("rail[shape=north_east]", { mirror: "x" }), "rail[shape=north_west]");
});

test("schematic, Litematica and vanilla NBT round trip block states and orientation", () => {
  const palette = ["minecraft:air", "minecraft:stone", "minecraft:oak_stairs[facing=east,half=top]"];
  const cells = [
    { x: -2, y: 5, z: 3, state: 1 },
    { x: -1, y: 6, z: 4, state: 2 },
  ];
  for (const format of ["schem", "litematic", "nbt"] as const) {
    const bytes = writeNbt(format, "test-structure", 5023, [-2, 5, 3, -1, 6, 4], palette, cells);
    const loaded = readNbt(format, bytes);
    const keys = format === "schem" ? ["-2,5,3", "-1,6,4"] : ["0,0,0", "1,1,1"];
    assert.equal(loaded.size, 2, format);
    assert.equal(loaded.get(keys[0]), "stone");
    assert.equal(loaded.get(keys[1]), normalizeBlock("oak_stairs[facing=east,half=top]"));
  }
});

test("version downgrades preserve colored materials and load stateless registry entries", async (t) => {
  const files: Record<string, unknown> = {
    "/26.2-summary/blocks/data.json": {
      air: [{}, {}], stone: [{}, {}], white_concrete: [{}, {}], white_concrete_powder: [{}, {}],
      red_wool: [{}, {}], red_sandstone_slab: [{ type: ["top", "bottom"] }, { type: "bottom" }],
    },
    "/26.2-summary/version.json": { data_version: 4903 },
    "/1.14.4-summary/blocks/data.json": { oak_log: [{ axis: ["x", "y", "z"] }, { axis: "y" }] },
    "/1.14.4-summary/registries/data.json": { block: ["air", "stone", "grass_path", "oak_log"] },
    "/1.14.4-summary/version.json": { data_version: 1976 },
  };
  t.mock.method(globalThis, "fetch", async (url: string) => {
    const entry = Object.keys(files).find((path) => url.endsWith(path));
    return entry ? Response.json(files[entry]) : new Response(null, { status: 404 });
  });
  const recent = await targetCatalog("26.2");
  assert.equal(recent.translate("white_concrete_stairs[facing=east]"), "minecraft:white_concrete");
  assert.equal(recent.translate("red_wool_slab"), "minecraft:red_wool");
  const older = await targetCatalog("1.14.4");
  assert.equal(older.dataVersion, 1976);
  assert.equal(older.translate("stone"), "minecraft:stone");
  assert.equal(older.translate("dirt_path"), "minecraft:grass_path");
  assert.equal(older.translate("oak_log[axis=x]"), "minecraft:oak_log[axis=x]");
});

test("1.13 can export with Prismarine block states when mcmeta has no release report", async (t) => {
  const files: Record<string, unknown> = {
    "/data/dataPaths.json": { pc: { "1.13.2": { blocks: "pc/1.13.2" }, "1.13.1": { blocks: "pc/1.13" } } },
    "/data/pc/common/protocolVersions.json": [
      { minecraftVersion: "1.13.2", dataVersion: 1631 },
      { minecraftVersion: "1.13.1", dataVersion: 1628 },
    ],
    "/data/pc/1.13/blocks.json": [
      { name: "air", minStateId: 0, defaultState: 0, states: [] },
      { name: "stone", minStateId: 1, defaultState: 1, states: [] },
      { name: "tube_coral", minStateId: 2, defaultState: 2, states: [] },
    ],
    "/data/pc/1.13.2/blocks.json": [
      { name: "air", minStateId: 0, defaultState: 0, states: [] },
      { name: "stone", minStateId: 1, defaultState: 1, states: [] },
      {
        name: "cauldron", minStateId: 1_000, defaultState: 1_000,
        states: [{ name: "level", type: "int", num_values: 4 }],
      },
    ],
  };
  t.mock.method(globalThis, "fetch", async (url: string) => {
    const entry = Object.keys(files).find((path) => url.endsWith(path));
    return entry ? Response.json(files[entry]) : new Response(null, { status: 404 });
  });
  const target = await targetCatalog("1.13.2");
  assert.equal(target.dataVersion, 1631);
  assert.equal(target.translate("cauldron"), "minecraft:cauldron[level=0]");
  const coralRelease = await targetCatalog("1.13.1");
  assert.equal(coralRelease.translate("dead_tube_coral[waterlogged=false]"), "minecraft:dead_tube_coral[waterlogged=false]");
});

test("material counts match placement items, paired blocks and item stack sizes", () => {
  const result = materialList([
    "minecraft:air", "minecraft:oak_door[half=upper]", "minecraft:oak_door[half=lower]",
    "minecraft:red_bed[facing=east,part=head]", "minecraft:red_bed[facing=east,part=foot]",
    "minecraft:oak_slab[type=double]", "minecraft:oak_wall_sign[facing=north]", "minecraft:oak_sign",
    "minecraft:water", "minecraft:sunflower[half=upper]", "minecraft:sunflower[half=lower]", "minecraft:wall_sign",
  ], [
    { x: 0, y: 1, z: 0, state: 1 },
    { x: 0, y: 0, z: 0, state: 2 },
    { x: 1, y: 1, z: 0, state: 1 },
    { x: 5, y: 0, z: 0, state: 3 },
    { x: 4, y: 0, z: 0, state: 4 },
    { x: 6, y: 0, z: 0, state: 5 },
    { x: 7, y: 0, z: 0, state: 6 },
    { x: 8, y: 0, z: 0, state: 7 },
    { x: 9, y: 0, z: 0, state: 8 },
    { x: 10, y: 1, z: 0, state: 9 },
    { x: 10, y: 0, z: 0, state: 10 },
    { x: 11, y: 0, z: 0, state: 11 },
  ]);
  assert.deepEqual(result.materials.map(({ id, items, stackSize }) => [id, items, stackSize]), [
    ["minecraft:oak_door", 2, 64],
    ["minecraft:oak_sign", 2, 16],
    ["minecraft:oak_slab", 2, 64],
    ["minecraft:red_bed", 1, 1],
    ["minecraft:sign", 1, 16],
    ["minecraft:sunflower", 1, 64],
  ]);
  assert.equal(result.materials.find(({ id }) => id === "minecraft:red_bed")?.shulkerBoxes, 1 / 27);
  assert.deepEqual(result.unplaceable, [{ id: "minecraft:water", blocks: 1 }]);
});
