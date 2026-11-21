import source from "../../../data/placement-items.json";
import { blockKey, getBlockDefaults, isAir, type Position } from "../../engine";

const aliases: Readonly<Record<string, string | null>> = source.aliases;
const stackSizes: Readonly<Record<string, number>> = source.stackSizes;
const olderAliases: Readonly<Record<string, string | null>> = {
  wall_sign: "sign", grass_path: null,
};
const bedAnchors: Readonly<Record<string, Position>> = {
  north: [0, 0, 1], south: [0, 0, -1], east: [-1, 0, 0], west: [1, 0, 0],
};

type Cell = { x: number; y: number; z: number; state: number };
type Placement = {
  block: string;
  item: string | null;
  units: number;
  anchor?: Position;
};

function placement(state: string): Placement {
  const [block, suffix] = state.replace(/^minecraft:/, "").split("[");
  const props: Record<string, string> = { ...getBlockDefaults(block) };
  if (suffix) {
    for (const setting of suffix.slice(0, -1).split(",")) {
      const [name, value] = setting.split("=");
      props[name] = value;
    }
  }
  const item = Object.hasOwn(aliases, block) ? aliases[block] :
    Object.hasOwn(olderAliases, block) ? olderAliases[block] : block;
  const units = block.endsWith("_slab") && props.type === "double" ? 2 : 1;
  if (props.half === "upper" || props.half === "lower") {
    return { block, item, units, anchor: [0, props.half === "upper" ? -1 : 0, 0] };
  }
  if (props.part === "head" || props.part === "foot") {
    return {
      block, item, units,
      anchor: props.part === "head" ? bedAnchors[props.facing] ?? [0, 0, 0] : [0, 0, 0],
    };
  }
  return { block, item, units };
}

export function materialList(palette: readonly string[], cells: Iterable<Cell>) {
  const materials = new Map<string, number>();
  const unplaceable = new Map<string, number>();
  const paired = new Set<string>();
  const placements = palette.map((state) => isAir(state) ? undefined : placement(state));
  for (const { x, y, z, state } of cells) {
    const spec = placements[state];
    if (!spec) continue;
    const { block, item, units, anchor } = spec;
    if (!item) {
      unplaceable.set(block, (unplaceable.get(block) ?? 0) + 1);
      continue;
    }
    if (anchor) {
      const key = `${block}:${blockKey(x + anchor[0], y + anchor[1], z + anchor[2])}`;
      if (paired.has(key)) continue;
      paired.add(key);
    }
    materials.set(item, (materials.get(item) ?? 0) + units);
  }
  return {
    materials: Array.from(materials, ([item, items]) => {
      const stackSize = stackSizes[item === "sign" ? "oak_sign" : item] ?? 64;
      return {
        id: `minecraft:${item}`, items, stackSize, stacks: items / stackSize,
        shulkerBoxes: items / (27 * stackSize),
      };
    }).sort((a, b) => b.items - a.items || a.id.localeCompare(b.id)),
    unplaceable: Array.from(unplaceable, ([block, blocks]) => ({ id: `minecraft:${block}`, blocks }))
      .sort((a, b) => b.blocks - a.blocks || a.id.localeCompare(b.id)),
  };
}
