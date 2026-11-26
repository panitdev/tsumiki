import { CATALOG_DATA_VERSION, CATALOG_VERSION, expandBlock } from "../../engine/catalog";
import { ToolError } from "../store";

type Properties = Record<string, string>;
type Catalog = Record<string, [Record<string, string[]>, Properties]>;
type VersionedCatalog = { blocks: Catalog; dataVersion: number };
export const currentVersion = CATALOG_VERSION;
export const currentDataVersion = CATALOG_DATA_VERSION;

const cachedVersions = new Map<string, Promise<VersionedCatalog>>();
const prismarine = "https://raw.githubusercontent.com/PrismarineJS/minecraft-data/68c9e840e127858e9548b0d477b992202120dfaa/data";

interface PrismarineBlock {
  name: string;
  minStateId: number;
  defaultState: number;
  states: { name: string; type: "bool" | "enum" | "int"; num_values: number; values?: (string | number)[] }[];
}

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error("Version data not found.");
  return response.json() as Promise<T>;
}

async function prismarineCatalog(version: string, signal: AbortSignal): Promise<VersionedCatalog> {
  const [paths, protocols] = await Promise.all([
    fetch(`${prismarine}/dataPaths.json`, { signal }).then(json<{ pc: Record<string, { blocks?: string }> }>),
    fetch(`${prismarine}/pc/common/protocolVersions.json`, { signal })
      .then(json<{ minecraftVersion: string; dataVersion: number }[]>),
  ]);
  const path = paths.pc[version]?.blocks;
  const protocol = protocols.find((entry) => entry.minecraftVersion === version);
  if (!path || !protocol || !Number.isSafeInteger(protocol.dataVersion)) throw new Error("Missing Java release.");
  const report = await fetch(`${prismarine}/${path}/blocks.json`, { signal }).then(json<PrismarineBlock[]>);
  const blocks: Catalog = Object.fromEntries(report.map(({ name, minStateId, defaultState, states }) => {
    const allowed = Object.fromEntries(states.map((state) => [
      state.name,
      state.type === "bool" ? ["true", "false"] : state.values?.map(String) ??
        Array.from({ length: state.num_values }, (_, index) => String(index)),
    ]));
    const defaults: Properties = {};
    let index = defaultState - minStateId;
    // State IDs count through the property values with the last property changing fastest.
    for (let i = states.length - 1; i >= 0; i--) {
      const key = states[i].name;
      const values = allowed[key];
      defaults[key] = values[index % values.length];
      index = Math.floor(index / values.length);
    }
    if (index !== 0 || Object.values(defaults).some((value) => value === undefined)) {
      throw new Error("Invalid default block state.");
    }
    return [name, [allowed, defaults]];
  }));
  if (version === "1.13.1" && path === "pc/1.13") {
    // Prismarine shares these releases. These changes come from the 1.13.1 vanilla block report.
    const waterlogged: Catalog[string] = [{ waterlogged: ["true", "false"] }, { waterlogged: "true" }];
    for (const coral of ["tube", "brain", "bubble", "fire", "horn"]) {
      blocks[`${coral}_coral`] = waterlogged;
      blocks[`dead_${coral}_coral`] = waterlogged;
    }
    blocks.conduit = waterlogged;
    blocks.tnt = [{ unstable: ["true", "false"] }, { unstable: "false" }];
  }
  if (!blocks.air || !blocks.stone) throw new Error("Incomplete target catalog.");
  return { blocks, dataVersion: protocol.dataVersion };
}

async function fetchCatalog(version: string): Promise<VersionedCatalog> {
  const signal = AbortSignal.timeout(8000);
  const source = `https://raw.githubusercontent.com/misode/mcmeta/refs/tags/${version}-summary`;
  const [blocks, metadata] = await Promise.all([
    fetch(`${source}/blocks/data.json`, { signal }),
    fetch(`${source}/version.json`, { signal }),
  ]);
  if (blocks.status === 404 || metadata.status === 404) return prismarineCatalog(version, signal);
  const [catalog, info] = await Promise.all([json<Catalog>(blocks), json<{ data_version: number }>(metadata)]);
  if (!catalog.air) {
    // Some older reports list only blocks with properties.
    const registry = await fetch(`${source}/registries/data.json`, { signal }).then(json<{ block: string[] }>);
    for (const name of registry.block) catalog[name] ??= [{}, {}];
  }
  if (!catalog.air || !catalog.stone || !Number.isSafeInteger(info.data_version)) {
    throw new Error("Incomplete target catalog.");
  }
  return { blocks: catalog, dataVersion: info.data_version };
}

async function olderVersion(version: string) {
  const components = version.split(".").map(Number);
  if (!/^(?:1\.(?:1[3-9]|[2-9]\d)(?:\.\d+)?|2[0-6]\.\d+(?:\.\d+)?)$/.test(version) ||
      components[0] > 26 || (components[0] === 26 && components[1] >= 3)) {
    throw new ToolError(`Unsupported target version "${version}".`, "Choose 26.3 or an older Java release from 1.13 onward.");
  }
  let data = cachedVersions.get(version);
  if (!data) {
    if (cachedVersions.size >= 12) cachedVersions.delete(cachedVersions.keys().next().value!);
    data = fetchCatalog(version).catch(() => {
      if (cachedVersions.get(version) === data) cachedVersions.delete(version);
      throw new ToolError(`Block data for Minecraft ${version} is unavailable.`, "Check the Java release number and server connectivity to GitHub.");
    });
    cachedVersions.set(version, data);
  }
  return data;
}

const replacements: [RegExp, string][] = [
  [/^sulfur$/, "yellow_concrete"], [/^cinnabar$/, "red_terracotta"],
  [/^(.+_(?:wool|concrete))_(?:stairs|slab)$/, "$1"],
  [/^(stripped_)?poplar(?=_|$)/, "$1pale_oak"], [/^(stripped_)?poplar(?=_|$)/, "$1birch"],
  [/^iron_chain$/, "chain"], [/^dirt_path$/, "grass_path"],
  [/^oak_sign$/, "sign"], [/^oak_wall_sign$/, "wall_sign"],
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
