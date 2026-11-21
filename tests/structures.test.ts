import assert from "node:assert/strict";
import test from "node:test";
import { blockKey, normalizeBlock, runBuild, turnBlock } from "../src/engine";
import { readNbt, writeNbt } from "../src/server/formats/nbt";

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
