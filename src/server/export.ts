import { unionBox, type Box } from "../engine/geometry";
import { sceneBlocks, type DisplayPart, type SceneData } from "../engine/scene";
import { writeNbt, type BlockDisplay } from "./formats/nbt";
import { materialList } from "./formats/materials";
import { targetCatalog } from "./formats/version";

export const formats = ["schem", "litematic", "nbt", "mcfunction"] as const;
export type Format = typeof formats[number];

/** Java 1.19.4, the first release with display entities. */
const DISPLAY_DATA_VERSION = 3337;

function decimal(value: number): string {
  // Command coordinates do not accept exponent notation.
  return value.toFixed(9).replace(/\.?0+$/, "").replace(/^-0$/, "0");
}

function toDisplay({ matrix: m }: DisplayPart, state: string): BlockDisplay {
  // The entity sits at the centre of its block, and the matrix places the unit cube around it.
  const pos = [0, 1, 2].map((axis) =>
    Math.round(((m[axis] + m[4 + axis] + m[8 + axis]) / 2 + m[12 + axis]) * 1e6) / 1e6) as BlockDisplay["pos"];
  return {
    pos, state,
    transformation: [
      m[0], m[4], m[8], m[12] - pos[0],
      m[1], m[5], m[9], m[13] - pos[1],
      m[2], m[6], m[10], m[14] - pos[2],
      0, 0, 0, 1,
    ],
  };
}

function snbtState(state: string): string {
  const [id, suffix] = state.split("[");
  const properties = suffix?.slice(0, -1).split(",").map((entry) => {
    const [name, value] = entry.split("=");
    return `${name}:"${value}"`;
  });
  return `{Name:"${id}"${properties ? `,Properties:{${properties.join(",")}}` : ""}}`;
}

/** Serializes a build. Block (0,0,0) of the build is the paste point. */
export async function exportBuild(name: string, build: SceneData, format: Format, version: string) {
  const target = await targetCatalog(version);
  const palette = ["minecraft:air"];
  const paletteIndices = new Map(palette.map((state, i) => [state, i]));
  const translated = new Map<string, string>();
  const substitutions = new Map<string, { from: string; to: string; count: number }>();
  const translate = (state: string) => {
    let exported = translated.get(state);
    if (exported === undefined) {
      exported = target.translate(state);
      translated.set(state, exported);
      const id = exported.split("[", 1)[0].slice("minecraft:".length);
      if (id !== state.split("[", 1)[0]) substitutions.set(state, { from: state, to: exported, count: 0 });
    }
    const replacement = substitutions.get(state);
    if (replacement) replacement.count++;
    return exported;
  };

  let bounds: Box | null = null;
  const cells: { x: number; y: number; z: number; state: number }[] = [];
  for (const { x, y, z, state } of sceneBlocks(build)) {
    const exported = translate(state);
    let index = paletteIndices.get(exported);
    if (index === undefined) {
      index = palette.push(exported) - 1;
      paletteIndices.set(exported, index);
    }
    cells.push({ x, y, z, state: index });
    bounds = unionBox(bounds, [x, y, z, x, y, z]);
  }

  const parts = build.instances.flatMap((instance) => instance.parts);
  const supported = target.dataVersion >= DISPLAY_DATA_VERSION;
  const displays = supported ? parts.map((part) => toDisplay(part, translate(part.block))) : [];
  for (const { pos } of displays) {
    const [x, y, z] = pos.map(Math.floor);
    bounds = unionBox(bounds, [x, y, z, x, y, z]);
  }

  const { materials, unplaceable } = materialList(palette, cells);
  let bytes: Uint8Array;
  if (format === "mcfunction") {
    // Strict placement preserves explicit neighbor-dependent states from Java 1.21.5 onward.
    const strict = target.dataVersion >= 4325 ? " strict" : "";
    const commands = cells.map(({ x, y, z, state }) => `setblock ~${x} ~${y} ~${z} ${palette[state]}${strict}`);
    for (const { pos: [x, y, z], state, transformation } of displays) {
      // align makes entity offsets start from the same block corner that setblock uses.
      commands.push(`execute align xyz run summon minecraft:block_display ~${decimal(x)} ~${decimal(y)} ~${decimal(z)} ` +
        `{block_state:${snbtState(state)},transformation:[${transformation.map((value) => `${decimal(value)}f`).join(",")}]}`);
    }
    bytes = Buffer.from(`${commands.join("\n")}\n`);
  } else {
    bytes = writeNbt(format, name, target.dataVersion, bounds, palette, cells, displays);
  }

  const corner = bounds ? bounds.slice(0, 3) : [0, 0, 0];
  return {
    bytes, materials, unplaceable,
    substitutions: [...substitutions.values()],
    omittedDisplays: parts.length - displays.length,
    paste: format === "nbt"
      ? `A structure file has no paste offset. Load it with its minimum corner ${corner.join(", ")} blocks from your anchor.`
      : "The paste point is the build's (0, 0, 0).",
  };
}

export function exportFileName(name: string, format: Format): string {
  return name.replace(/[<>:"|?*]/g, "_") + `.${format}`;
}
