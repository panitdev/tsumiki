import {
  NbtByteArray, NbtCompound, NbtDouble, NbtFile, NbtFloat, NbtInt, NbtIntArray, NbtList, NbtLong,
  NbtLongArray, NbtShort, NbtString, NbtType,
} from "deepslate/nbt";
import { gunzipSync, inflateSync } from "node:zlib";
import { normalizeBlock } from "../../engine/catalog";
import type { Box } from "../../engine/geometry";
import { ToolError } from "../store";

type Vec = [number, number, number];
/** Blocks read back from a file, keyed "x,y,z". */
type Blocks = Map<string, string>;
export interface BlockDisplay {
  /** World position of the entity. */
  pos: Vec;
  /** Full block state, such as minecraft:lantern[hanging=true]. */
  state: string;
  /** Row-major affine matrix relative to pos. */
  transformation: number[];
}
type Cell = { x: number; y: number; z: number; state: number };
type Kind = "schem" | "litematic" | "nbt";
const maxVolume = 16_000_000;
const maxBlocks = 2_000_000;

function invalid(message = "The file contains invalid structure data."): never {
  throw new ToolError(message, "Use a valid Java structure template, Sponge v2/v3 schematic, or Litematica schematic.");
}

function dimension(w: number, h: number, d: number): Vec {
  if (![w, h, d].every(n => Number.isSafeInteger(n) && n >= 0) || w * h * d > maxVolume) {
    invalid("The structure's bounding volume exceeds the 16-million-cell format limit.");
  }
  return [w, h, d];
}

function vecTag([x, y, z]: Vec) {
  return NbtCompound.create().set("x", new NbtInt(x)).set("y", new NbtInt(y)).set("z", new NbtInt(z));
}

function readVec(tag: NbtCompound): Vec {
  return [tag.getNumber("x"), tag.getNumber("y"), tag.getNumber("z")];
}

function listVec([x, y, z]: Vec) {
  return new NbtList([new NbtInt(x), new NbtInt(y), new NbtInt(z)], NbtType.Int);
}

function stateTag(block: string) {
  const [id, suffix] = block.split("[");
  const result = NbtCompound.create().set("Name", new NbtString(id));
  if (suffix) {
    const props = NbtCompound.create();
    for (const entry of suffix.slice(0, -1).split(",")) {
      const [key, value] = entry.split("=");
      props.set(key, new NbtString(value));
    }
    result.set("Properties", props);
  }
  return result;
}

function stateString(tag: NbtCompound) {
  const id = tag.getString("Name");
  const props = tag.getCompound("Properties");
  const pairs = Array.from(props.keys(), k => `${k}=${props.getString(k)}`);
  return pairs.length ? `${id}[${pairs.join(",")}]` : id;
}

function bitsFor(size: number) {
  return BigInt(Math.max(2, Math.ceil(Math.log2(size))));
}

function relativeBounds(bounds: Box | null): { origin: Vec; size: Vec } {
  if (!bounds) return { origin: [0, 0, 0], size: [1, 1, 1] };
  const [x, y, z, maxX, maxY, maxZ] = bounds;
  return { origin: [x, y, z], size: dimension(maxX - x + 1, maxY - y + 1, maxZ - z + 1) };
}

function doubleList(values: Vec) {
  return new NbtList(values.map((value) => new NbtDouble(value)), NbtType.Double);
}

function displayData(tag: NbtCompound, { state, transformation }: BlockDisplay) {
  return tag.set("block_state", stateTag(state))
    .set("transformation", new NbtList(transformation.map((value) => new NbtFloat(value)), NbtType.Float));
}

/** `bounds` must cover the cells and the positions of the displays. */
export function writeNbt(kind: Kind, name: string, dataVersion: number, bounds: Box | null, palette: string[], cells: Cell[],
    displays: BlockDisplay[] = []) {
  const { origin, size: [w, h, d] } = relativeBounds(bounds);
  const file = NbtFile.create({ name: "", compression: "gzip" });
  const paletteTags = () => new NbtList(palette.map(stateTag), NbtType.Compound);
  const relative = ({ pos }: BlockDisplay) => pos.map((value, axis) => value - origin[axis]) as Vec;
  const entities = (build: (display: BlockDisplay) => NbtCompound) =>
    new NbtList(displays.map(build), NbtType.Compound);

  if (kind === "nbt") {
    const blocks = cells.map(({ x, y, z, state }) => NbtCompound.create()
      .set("pos", listVec([x - origin[0], y - origin[1], z - origin[2]]))
      .set("state", new NbtInt(state)));
    file.root.set("size", listVec([w, h, d])).set("DataVersion", new NbtInt(dataVersion))
      .set("palette", paletteTags())
      .set("entities", entities((display) => NbtCompound.create()
        .set("pos", doubleList(relative(display)))
        .set("blockPos", listVec(relative(display).map(Math.floor) as Vec))
        .set("nbt", displayData(NbtCompound.create().set("id", new NbtString("minecraft:block_display")), display))))
      .set("blocks", new NbtList(blocks, NbtType.Compound));
    return file.write();
  }

  const dense = new Uint32Array(w * h * d);
  for (const { x, y, z, state } of cells) {
    const index = (x - origin[0]) + (z - origin[2]) * w + (y - origin[1]) * w * d;
    dense[index] = state;
  }
  if (kind === "schem") {
    if (Math.max(w, h, d) > 65535) invalid("Sponge schematics support dimensions up to 65,535.");
    const values = NbtCompound.create();
    palette.forEach((id, index) => values.set(id, new NbtInt(index)));
    const encoded = new Uint8Array(dense.length * (palette.length <= 128 ? 1 : palette.length <= 16384 ? 2 : 3));
    let at = 0;
    for (let value of dense) {
      while (value >= 128) {
        encoded[at++] = (value & 127) | 128;
        value >>>= 7;
      }
      encoded[at++] = value;
    }
    file.root.set("Schematic", NbtCompound.create()
      .set("Version", new NbtInt(3)).set("DataVersion", new NbtInt(dataVersion))
      .set("Width", new NbtShort(w)).set("Height", new NbtShort(h)).set("Length", new NbtShort(d))
      .set("Offset", new NbtIntArray(origin))
      .set("Entities", entities((display) => NbtCompound.create()
        .set("Id", new NbtString("minecraft:block_display"))
        .set("Pos", doubleList(relative(display)))
        .set("Data", displayData(NbtCompound.create(), display))))
      .set("Blocks", NbtCompound.create().set("Palette", values)
        .set("Data", new NbtByteArray(encoded.subarray(0, at))).set("BlockEntities", new NbtList())));
  } else {
    const bits = bitsFor(palette.length);
    const packed = new BigUint64Array(Math.ceil((dense.length * Number(bits)) / 64));
    for (let i = 0; i < dense.length; i++) {
      if (!dense[i]) continue;
      const bit = BigInt(i) * bits;
      const word = Number(bit >> 6n);
      const offset = bit & 63n;
      const value = BigInt(dense[i]);
      packed[word] |= value << offset;
      if (offset + bits > 64n) packed[word + 1] |= value >> (64n - offset);
    }
    const region = NbtCompound.create().set("Position", vecTag(origin)).set("Size", vecTag([w, h, d]))
      .set("BlockStatePalette", paletteTags()).set("BlockStates", new NbtLongArray(packed))
      .set("Entities", entities((display) => displayData(NbtCompound.create()
        .set("id", new NbtString("minecraft:block_display"))
        .set("Pos", doubleList(relative(display))), display)))
      .set("TileEntities", new NbtList())
      .set("PendingBlockTicks", new NbtList()).set("PendingFluidTicks", new NbtList());
    const now = new NbtLong(BigInt(Date.now()));
    const metadata = NbtCompound.create().set("Name", new NbtString(name)).set("Author", new NbtString("Tsumiki"))
      .set("Description", new NbtString("")).set("RegionCount", new NbtInt(1)).set("TotalBlocks", new NbtInt(cells.length))
      .set("TotalVolume", new NbtInt(dense.length)).set("EnclosingSize", vecTag([w, h, d]))
      .set("TimeCreated", now).set("TimeModified", now);
    file.root.set("Version", new NbtInt(6)).set("SubVersion", new NbtInt(1))
      .set("MinecraftDataVersion", new NbtInt(dataVersion)).set("Metadata", metadata)
      .set("Regions", NbtCompound.create().set(name, region));
  }
  return file.write();
}

const renamedBlocks: Readonly<Record<string, string>> = {
  grass: "short_grass",
  grass_path: "dirt_path",
  chain: "iron_chain",
  wall_sign: "oak_wall_sign",
  sign: "oak_sign",
};

function upgradeState(state: string) {
  const bare = state.replace(/^minecraft:/, "");
  if (bare.startsWith("cauldron[level=")) {
    return bare === "cauldron[level=0]" ? "cauldron" : bare.replace(/^cauldron/, "water_cauldron");
  }
  const id = bare.split("[", 1)[0];
  const renamed = Object.hasOwn(renamedBlocks, id) ? renamedBlocks[id] : undefined;
  return renamed ? renamed + bare.slice(id.length) : bare;
}

function normalizePalette(states: string[]) {
  return states.map((state) => {
    if (/^(?:minecraft:)?(?:air|cave_air|void_air)$/.test(state)) return "air";
    try {
      return normalizeBlock(upgradeState(state));
    } catch (error) {
      throw new ToolError(`Cannot import block "${state}".`, error instanceof Error ? error.message : "Use blocks supported by Java 26.3.");
    }
  });
}

function add(map: Blocks, point: Vec, state?: string) {
  if (!state) invalid();
  if (!point.every(coord => Number.isInteger(coord) && Math.abs(coord) <= 30_000_000)) invalid("The file exceeds supported coordinates.");
  if (state === "air") return;
  const key = point.join(",");
  map.set(key, state);
  if (map.size > maxBlocks) invalid("The import exceeds two million blocks.");
}

function addDense(map: Blocks, n: number, [w, , d]: Vec, origin: Vec, state?: string) {
  add(map, [origin[0] + (n % w), origin[1] + Math.floor(n / (w * d)), origin[2] + (Math.floor(n / w) % d)], state);
}

export function readNbt(kind: Kind, data: Uint8Array): Blocks {
  const cap = { maxOutputLength: 96 * 1024 * 1024 };
  const raw = data[0] === 31 && data[1] === 139 ? gunzipSync(data, cap) : data[0] === 0x78 ? inflateSync(data, cap) : data;
  const { root } = NbtFile.read(raw, { compression: "none" });
  const blocks: Blocks = new Map();
  if (kind === "nbt") {
    const paletteTag = root.hasList("palette") ? root.getList("palette", NbtType.Compound) :
      root.getList("palettes", NbtType.List).get(0);
    if (!paletteTag || !root.hasList("blocks")) invalid();
    const palette = normalizePalette(paletteTag.getItems().map(tag => stateString(tag as NbtCompound)));
    for (const block of root.getList("blocks", NbtType.Compound).getItems()) {
      const pos = block.getList("pos", NbtType.Int).getAsTuple(3, tag => tag?.getAsNumber() ?? NaN);
      add(blocks, pos, palette[block.getNumber("state")]);
    }
  } else if (kind === "schem") {
    const schematic = root.hasCompound("Schematic") ? root.getCompound("Schematic") : root;
    const version = schematic.getNumber("Version");
    if (version !== 2 && version !== 3) invalid("Only Sponge schematic versions 2 and 3 are supported.");
    const size = dimension(schematic.getNumber("Width") & 65535, schematic.getNumber("Height") & 65535, schematic.getNumber("Length") & 65535);
    const volume = size[0] * size[1] * size[2];
    const origin = schematic.getIntArray("Offset").getAsTuple(3, tag => tag?.getAsNumber() ?? 0);
    const container = version === 3 ? schematic.getCompound("Blocks") : schematic;
    const states = container.getCompound("Palette");
    const ids = Array.from(states.keys());
    const palette = new Map(normalizePalette(ids).map((state, i) => [states.getNumber(ids[i]), state]));
    const bytes = container.getByteArray(version === 3 ? "Data" : "BlockData");
    let cursor = 0;
    for (let n = 0; n < volume; n++) {
      let value = 0;
      let next: number;
      let shift = 0;
      do {
        const part = bytes.get(cursor++);
        if (!part || shift > 28) invalid();
        next = part.getAsNumber() & 255;
        value |= (next & 127) << shift;
        shift += 7;
      } while (next & 128);
      addDense(blocks, n, size, origin, palette.get(value));
    }
    if (cursor !== bytes.length) invalid();
  } else {
    if (!root.hasCompound("Regions")) invalid();
    const regions = root.getCompound("Regions");
    let totalVolume = 0;
    for (const name of regions.keys()) {
      const region = regions.getCompound(name);
      const lengths = readVec(region.getCompound("Size"));
      const position = readVec(region.getCompound("Position"));
      const origin = position.map((p, i) => p + (lengths[i] < 0 ? lengths[i] + 1 : 0)) as Vec;
      const size = dimension(Math.abs(lengths[0]), Math.abs(lengths[1]), Math.abs(lengths[2]));
      const volume = size[0] * size[1] * size[2];
      totalVolume += volume;
      if (totalVolume > maxVolume) invalid("The combined volume of the Litematica regions exceeds 16 million cells.");
      const palette = normalizePalette(region.getList("BlockStatePalette", NbtType.Compound).getItems().map(stateString));
      const bits = bitsFor(palette.length);
      const mask = (1n << bits) - 1n;
      const packed = new BigUint64Array(region.getLongArray("BlockStates").getItems().map(tag => tag.toBigInt()));
      if (packed.length !== Math.ceil((volume * Number(bits)) / 64)) invalid();
      for (let n = 0; n < volume; n++) {
        const bit = BigInt(n) * bits;
        const word = Number(bit >> 6n);
        const offset = bit & 63n;
        let index = packed[word] >> offset;
        if (offset + bits > 64n) index |= packed[word + 1] << (64n - offset);
        addDense(blocks, n, size, origin, palette[Number(index & mask)]);
      }
    }
  }
  return blocks;
}
