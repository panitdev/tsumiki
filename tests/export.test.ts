import assert from "node:assert/strict";
import test from "node:test";
import { NbtCompound, NbtFile, NbtList, NbtType } from "deepslate/nbt";
import { gunzipSync } from "node:zlib";
import { buildSource } from "../src/engine";
import { exportBuild } from "../src/server/export";
import { readNbt } from "../src/server/formats/nbt";

// A negative corner shows whether (0,0,0) really is the paste point.
const source = `
  fill([-3, 2, 4], [-3, 2, 5], "stone")
  model("lamp", [{ block: "lantern[hanging=true]", at: [0, 0, 0], scale: [2, 1, 1] }])
  use("lamp", { at: [6.5, 3.5, 4.5] })
`;

async function build() {
  const { data } = await buildSource(source, null);
  assert(data);
  return data;
}

function root(bytes: Uint8Array) {
  return NbtFile.read(gunzipSync(bytes), { compression: "none" }).root;
}

const numbers = (tag: NbtCompound, key: string) => (tag.get(key) as NbtList).map((item) => item.getAsNumber());

function assertDisplay(data: NbtCompound) {
  assert.equal(data.getCompound("block_state").getString("Name"), "minecraft:lantern");
  assert.equal(data.getCompound("block_state").getCompound("Properties").getString("hanging"), "true");
  // Row-major: the translation is the last column, here from the centre to the unit cube's corner.
  assert.deepEqual(numbers(data, "transformation"),
    [2, 0, 0, -1, 0, 1, 0, -0.5, 0, 0, 1, -0.5, 0, 0, 0, 1]);
}

test("schem keeps the paste point in Offset and places entities relative to the schematic origin", async () => {
  const { bytes, omittedDisplays } = await exportBuild("test", await build(), "schem", "26.3");
  assert.equal(omittedDisplays, 0);
  const schematic = root(bytes).getCompound("Schematic");
  assert.deepEqual(Array.from(schematic.getIntArray("Offset").getItems(), (tag) => tag.getAsNumber()), [-3, 2, 4]);
  const entity = schematic.getList("Entities", NbtType.Compound).get(0) as NbtCompound;
  assert.equal(entity.getString("Id"), "minecraft:block_display");
  assert.deepEqual(numbers(entity, "Pos"), [9.5, 1.5, 0.5]);
  assertDisplay(entity.getCompound("Data"));
  assert.deepEqual([...readNbt("schem", bytes).keys()].sort(), ["-3,2,4", "-3,2,5"]);
});

test("litematic positions the region at the build's corner with entities relative to it", async () => {
  const { bytes } = await exportBuild("test", await build(), "litematic", "26.3");
  const region = root(bytes).getCompound("Regions").getCompound("test");
  const position = region.getCompound("Position");
  assert.deepEqual(["x", "y", "z"].map((axis) => position.getNumber(axis)), [-3, 2, 4]);
  const entity = region.getList("Entities", NbtType.Compound).get(0) as NbtCompound;
  assert.equal(entity.getString("id"), "minecraft:block_display");
  assert.deepEqual(numbers(entity, "Pos"), [9.5, 1.5, 0.5]);
  assertDisplay(entity);
  assert.deepEqual([...readNbt("litematic", bytes).keys()].sort(), ["-3,2,4", "-3,2,5"]);
});

test("structure templates hold displays relative to their corner and say where to load them", async () => {
  const { bytes, paste } = await exportBuild("test", await build(), "nbt", "26.3");
  assert.match(paste, /-3, 2, 4/);
  const entity = root(bytes).getList("entities", NbtType.Compound).get(0) as NbtCompound;
  assert.deepEqual(numbers(entity, "pos"), [9.5, 1.5, 0.5]);
  assert.deepEqual(numbers(entity, "blockPos"), [9, 1, 0]);
  assertDisplay(entity.getCompound("nbt"));
});

test("mcfunction offsets are relative to the paste point", async () => {
  const { bytes } = await exportBuild("test", await build(), "mcfunction", "26.3");
  assert.deepEqual(new TextDecoder().decode(bytes).trim().split("\n"), [
    "setblock ~-3 ~2 ~4 minecraft:stone strict",
    "setblock ~-3 ~2 ~5 minecraft:stone strict",
    'execute align xyz run summon minecraft:block_display ~6.5 ~3.5 ~4.5 {block_state:{Name:"minecraft:lantern",' +
      'Properties:{hanging:"true",waterlogged:"false"}},transformation:[2f,0f,0f,-1f,0f,1f,0f,-0.5f,0f,0f,1f,-0.5f,0f,0f,0f,1f]}',
  ]);
});

test("releases without display entities omit them and say so", async (t) => {
  t.mock.method(globalThis, "fetch", async (url: string) => {
    if (url.endsWith("/1.19.3-summary/version.json")) return Response.json({ data_version: 3218 });
    if (url.endsWith("/1.19.3-summary/blocks/data.json")) return Response.json({ air: [{}, {}], stone: [{}, {}] });
    return new Response(null, { status: 404 });
  });
  const result = await exportBuild("test", await build(), "mcfunction", "1.19.3");
  assert.equal(result.omittedDisplays, 1);
  assert.doesNotMatch(new TextDecoder().decode(result.bytes), /block_display/);
});
