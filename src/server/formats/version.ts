import { expandBlock } from "../../engine";
import { ToolError } from "../store";

type Properties = Record<string, string>;
type Catalog = Record<string, [Record<string, string[]>, Properties]>;
export const currentVersion = "26.3";
export const currentDataVersion = 5023;

const cachedVersions = new Map<string, Promise<{ blocks: Catalog; dataVersion: number }>>();

async function olderVersion(version: string) {
  const components = version.split(".").map(Number);
  if (!/^(?:1\.(?:1[3-9]|[2-9]\d)(?:\.\d+)?|2[0-6]\.\d+(?:\.\d+)?)$/.test(version) ||
      components[0] > 26 || (components[0] === 26 && components[1] >= 3)) {
    throw new ToolError(`Unsupported target version "${version}".`, "Choose 26.3 or an older Java release from 1.13 onward.");
  }
  const source = `https://raw.githubusercontent.com/misode/mcmeta/refs/tags/${version}-summary`;
  const fetchVersion = async () => {
    try {
      const signal = AbortSignal.timeout(8000);
      const [blocks, metadata] = await Promise.all([
        fetch(`${source}/blocks/data.json`, { signal }),
        fetch(`${source}/version.json`, { signal }),
      ]);
      if (!blocks.ok || !metadata.ok) throw new Error("Version not found.");
      const [catalog, info] = await Promise.all([blocks.json() as Promise<Catalog>, metadata.json()]);
      if (!catalog.air || !Number.isSafeInteger(info.data_version)) throw new Error("Incomplete target catalog.");
      return { blocks: catalog, dataVersion: info.data_version as number };
    } catch {
      cachedVersions.delete(version);
      throw new ToolError(`Block data for Minecraft ${version} is unavailable.`, "Check the Java release number and server connectivity to GitHub.");
    }
  };
  let data = cachedVersions.get(version);
  if (!data) {
    if (cachedVersions.size >= 12) cachedVersions.delete(cachedVersions.keys().next().value!);
    data = fetchVersion();
    cachedVersions.set(version, data);
  }
  return data;
}

const replacements: [RegExp, string][] = [
  [/^sulfur$/, "yellow_concrete"], [/^cinnabar$/, "red_terracotta"],
  [/^resin_bricks?/, "red_sandstone"], [/^dried_ghast$/, "soul_sand"],
  [/^pale_oak(?=_|$)/, "birch"], [/^cherry(?=_|$)/, "birch"],
  [/^mangrove(?=_|$)/, "jungle"], [/^(?:crimson|warped)(?=_|$)/, "dark_oak"],
  [/^bamboo_mosaic/, "oak_planks"], [/^bamboo(?=_|$)/, "birch"],
  [/^(?:waxed_)?(?:oxidized_|weathered_|exposed_)?cut_copper/, "stone_brick"],
  [/^(?:waxed_)?(?:oxidized_|weathered_|exposed_)?copper_grate$/, "iron_bars"],
  [/^(?:waxed_)?(?:oxidized_|weathered_|exposed_)?copper(?=_|$)/, "iron"],
  [/^polished_tuff/, "polished_andesite"], [/^tuff_brick/, "stone_brick"],
  [/^tuff/, "andesite"], [/^deepslate_brick/, "stone_brick"],
  [/^deepslate_tile/, "stone_brick"], [/^(?:polished_|cobbled_)?deepslate/, "cobblestone"],
  [/^blackstone/, "cobblestone"], [/^short_grass$/, "grass"], [/^grass_path$/, "dirt_path"],
];

function selectReplacement(id: string, catalog: Catalog, properties: Properties) {
  for (const [prefix, replacement] of replacements) {
    const candidate = id.replace(prefix, replacement);
    if (candidate !== id && Object.hasOwn(catalog, candidate)) return candidate;
  }
  const tokens = new Set(id.split("_"));
  const form = id.split("_").at(-1);
  const entries = Object.keys(catalog);
  let best = "stone";
  let score = 0;
  for (const candidate of entries) {
    if (candidate === "air" || candidate.endsWith("_air")) continue;
    const parts = candidate.split("_");
    const materialMatches = parts.filter(p => p !== form && tokens.has(p)).length;
    const sameForm = parts.at(-1) === form;
    const matchingProperties = Object.keys(properties).filter(key => key in catalog[candidate][0]).length;
    const rank = materialMatches * 8 + Number(sameForm) * 5 + matchingProperties - Math.abs(parts.length - tokens.size);
    if (rank > score) { score = rank; best = candidate; }
  }
  return best;
}

export function stringifyState(id: string, properties: Properties) {
  const parts = Object.entries(properties).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`);
  return `minecraft:${id}${parts.length ? `[${parts.join(",")}]` : ""}`;
}

export async function targetCatalog(version: string) {
  const target = version === currentVersion ? undefined : await olderVersion(version);
  return {
    dataVersion: target?.dataVersion ?? currentDataVersion,
    translate(state: string) {
      const { id, properties } = expandBlock(state);
      if (!target) return stringifyState(id, properties);
      const name = Object.hasOwn(target.blocks, id) ? id : selectReplacement(id, target.blocks, properties);
      const [allowed, defaults] = target.blocks[name];
      const overrides = Object.fromEntries(Object.entries(properties).filter(([k, v]) => allowed[k]?.includes(v)));
      return stringifyState(name, { ...defaults, ...overrides });
    },
  };
}
