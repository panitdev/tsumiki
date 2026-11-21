import source from "../../data/blocks.json";

interface CatalogEntry {
  color: string | null;
  properties?: Record<string, readonly string[]>;
  defaults?: Record<string, string>;
  turns?: readonly [number, number, number];
}

interface CatalogData {
  version: string;
  dataVersion: number;
  blocks: Record<string, CatalogEntry>;
  turns: readonly (readonly number[])[];
}

const catalog = source as unknown as CatalogData;
const entries = new Map(Object.entries(catalog.blocks));
const emptyProperties: Readonly<Record<string, string>> = Object.freeze({});
const emptyAllowed: Readonly<Record<string, readonly string[]>> = Object.freeze({});

export const CATALOG_VERSION = catalog.version;
export const CATALOG_DATA_VERSION = catalog.dataVersion;

export type BlockFamily = { block: string } & Record<string, string>;

export interface ParsedBlock {
  id: string;
  properties: Record<string, string>;
  defaults: Readonly<Record<string, string>>;
}

export class BlockValidationError extends Error {
  constructor(message: string, private readonly detail: string) {
    super(message);
    this.name = "BlockValidationError";
  }

  get hint(): string {
    return this.detail;
  }
}

export class UnknownBlockError extends BlockValidationError {
  constructor(public readonly block: string) {
    super(`Unknown block "${block}".`, "Use blocks to find a valid Minecraft block ID.");
    this.name = "UnknownBlockError";
  }

  get suggestions(): string[] {
    return suggestBlocks(this.block);
  }

  override get hint(): string {
    const suggestions = this.suggestions;
    return suggestions.length
      ? `Did you mean ${suggestions.map((id) => `"${id}"`).join(", ")}?`
      : super.hint;
  }
}

export function blockId(input: string): string {
  return input.split("[", 1)[0].trim().replace(/^minecraft:/, "");
}

export function isAir(input: string): boolean {
  const id = blockId(input);
  return id === "air" || id === "cave_air" || id === "void_air";
}

function editDistance(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 0; i < left.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < right.length; j++) {
      next[j + 1] = Math.min(previous[j + 1] + 1, next[j] + 1,
        previous[j] + Number(left[i] !== right[j]));
    }
    previous = next;
  }
  return previous[right.length];
}

export function suggestBlocks(input: string, limit = 3): string[] {
  const id = blockId(input).toLowerCase().replaceAll(" ", "_");
  if (!id || id.length > 64) return [];
  const maximum = Math.max(2, Math.floor(id.length / 4));
  return [...entries.keys()]
    .filter((candidate) => Math.abs(candidate.length - id.length) <= maximum)
    .map((candidate) => ({ candidate, distance: editDistance(candidate, id) }))
    .filter(({ distance }) => distance <= maximum)
    .sort((a, b) => a.distance - b.distance || a.candidate.localeCompare(b.candidate))
    .slice(0, limit)
    .map(({ candidate }) => candidate);
}

export function parseBlock(input: string): ParsedBlock {
  const match = /^((?:[a-z0-9_.-]+:)?[a-z0-9_./-]+)(?:\[([^\[\]]*)\])?$/.exec(input.trim());
  if (!match) {
    throw new BlockValidationError(`Invalid block "${input}".`, "Use a block ID such as oak_stairs[facing=north].");
  }
  const id = match[1].replace(/^minecraft:/, "");
  const entry = entries.get(id);
  if (!entry) throw new UnknownBlockError(id);

  const properties: Record<string, string> = Object.create(null);
  const allowed = entry.properties ?? emptyAllowed;
  for (const assignment of match[2]?.trim() ? match[2].split(",") : []) {
    const state = /^\s*([a-z0-9_]+)\s*=\s*([a-z0-9_-]+)\s*$/.exec(assignment);
    if (!state) {
      throw new BlockValidationError(`Invalid state "${assignment.trim()}" for ${id}.`, "Set state properties as name=value.");
    }
    const [, name, value] = state;
    if (!Object.hasOwn(allowed, name)) {
      const keys = Object.keys(allowed);
      throw new BlockValidationError(
        `Unknown state "${name}" for ${id}.`,
        keys.length ? `Valid properties are ${keys.join(", ")}.` : `${id} has no state properties.`,
      );
    }
    if (Object.hasOwn(properties, name)) {
      throw new BlockValidationError(`Duplicate state "${name}" for ${id}.`, "Specify each state property once.");
    }
    if (!allowed[name].includes(value)) {
      throw new BlockValidationError(
        `Invalid value "${value}" for ${id}.${name}.`,
        `Valid values are ${allowed[name].join(", ")}.`,
      );
    }
    properties[name] = value;
  }
  return { id, properties, defaults: entry.defaults ?? emptyProperties };
}

function formatBlock(id: string, properties: Record<string, string>, defaults: Readonly<Record<string, string>>): string {
  const states = Object.keys(defaults)
    .filter((name) => Object.hasOwn(properties, name) && defaults[name] !== properties[name])
    .map((name) => `${name}=${properties[name]}`);
  return states.length ? `${id}[${states.join(",")}]` : id;
}

export function normalizeBlock(input: string): string {
  const { id, properties, defaults } = parseBlock(input);
  return formatBlock(id, properties, defaults);
}

export function expandBlock(input: string): { id: string; properties: Record<string, string> } {
  const { id, properties, defaults } = parseBlock(input);
  return { id, properties: { ...defaults, ...properties } };
}

export function getBlockDefaults(id: string): Readonly<Record<string, string>> | null {
  const entry = entries.get(blockId(id));
  return entry ? entry.defaults ?? emptyProperties : null;
}

export interface TurnOptions {
  rotate?: number;
  mirror?: "x" | "z";
}

export function turnBlock(input: string, options: TurnOptions = {}): string {
  const { rotate = 0, mirror } = options;
  if (!Number.isSafeInteger(rotate) || rotate % 90 !== 0) {
    throw new BlockValidationError("Invalid rotation.", "Set rotate to a multiple of 90 degrees clockwise.");
  }
  if (mirror !== undefined && mirror !== "x" && mirror !== "z") {
    throw new BlockValidationError("Invalid mirror axis.", 'Set mirror to "x" or "z".');
  }
  const { id, properties, defaults } = parseBlock(input);
  const entry = entries.get(id)!;
  if (!entry.turns || !entry.properties) return formatBlock(id, properties, defaults);

  const dimensions = Object.entries(entry.properties);
  let index = 0;
  for (const [name, allowed] of dimensions) {
    index = index * allowed.length + allowed.indexOf(properties[name] ?? defaults[name]);
  }
  const [quarterTurn, flipX, flipZ] = entry.turns;
  const turns = ((rotate / 90 % 4) + 4) % 4;
  if (quarterTurn >= 0) {
    for (let i = 0; i < turns; i++) index = catalog.turns[quarterTurn][index];
  }
  const reflection = mirror === "x" ? flipX : mirror === "z" ? flipZ : -1;
  if (reflection >= 0) index = catalog.turns[reflection][index];

  for (let i = dimensions.length - 1; i >= 0; i--) {
    const [name, allowed] = dimensions[i];
    properties[name] = allowed[index % allowed.length];
    index = Math.floor(index / allowed.length);
  }
  return formatBlock(id, properties, defaults);
}

const familyForms = [
  "wall_hanging_sign", "wood", "hyphae", "wall_sign", "hanging_sign", "fence_gate", "pressure_plate",
  "stairs", "slab", "wall", "fence", "door", "trapdoor", "button", "sign", "shelf", "planks", "log",
  "stem", "leaves", "sapling", "pillar",
] as const;

function deriveFamily(stem: string): BlockFamily | undefined {
  const block = [`${stem}_planks`, stem, `${stem}s`, `${stem}_block`].find((id) => entries.has(id));
  if (!block) return;
  const family: BlockFamily = { block };
  for (const form of familyForms) {
    const name = `${stem}_${form}`;
    if (entries.has(name)) family[form] = name;
  }
  for (const form of ["log", "wood", "stem", "hyphae", "block"]) {
    const name = `stripped_${stem}_${form}`;
    if (entries.has(name)) family[`stripped_${form}`] = name;
  }
  if (stem === "bamboo") family.log = "bamboo_block";
  return family;
}

export function blockFamily(input: string): BlockFamily {
  const id = blockId(input);
  const unstripped = id.replace(/^stripped_/, "");
  const stems = [unstripped, unstripped.replace(/(?<=brick|tile)s$/, ""), unstripped.replace(/_block$/, "")];
  for (const form of familyForms) {
    const suffix = `_${form}`;
    if (unstripped.endsWith(suffix)) stems.push(unstripped.slice(0, -suffix.length));
  }
  for (const stem of new Set(stems)) {
    const family = deriveFamily(stem);
    if (family && Object.keys(family).length > 1) return family;
  }
  if (entries.has(id)) return { block: id };
  throw new UnknownBlockError(id);
}

function colorTone(color: string | null): string {
  if (!color) return "neutral";
  const rgb = [1, 3, 5].map((start) => Number.parseInt(color.slice(start, start + 2), 16) / 255);
  const [red, green, blue] = rgb;
  const max = Math.max(...rgb);
  const min = Math.min(...rgb);
  const chroma = max - min;
  const lightness = (max + min) / 2;
  if (lightness < 0.15) return "black";
  if (lightness > 0.92) return "white";
  const brightness = lightness < 0.43 ? "dark " : lightness >= 0.68 ? "light " : "";
  if (chroma < 0.095) return `${brightness}gray`;

  const hue = ((max === red ? (green - blue) / chroma : max === green ? (blue - red) / chroma + 2 :
    (red - green) / chroma + 4) * 60 + 360) % 360;
  if (hue < 18 || hue >= 345) return `${brightness}${lightness >= 0.68 ? "pink" : "red"}`;
  if (hue < 48) return `${brightness}${lightness < 0.55 ? "brown" : "orange"}`;
  if (hue < 70) return `${brightness}yellow`;
  if (hue < 162) return `${brightness}green`;
  if (hue < 205) return `${brightness}cyan`;
  if (hue < 265) return `${brightness}blue`;
  return `${brightness}purple`;
}

interface BlockMatch {
  id: string;
  color: string | null;
  tone: string;
}

const matches = [...entries].map(([id, entry]) => ({
  id,
  color: entry.color,
  tone: colorTone(entry.color),
}));

export function searchBlocks(q: string):
  | { version: string; exact: true; block: BlockMatch & {
      states: Readonly<Record<string, readonly string[]>>;
      defaults: Readonly<Record<string, string>>;
      family: BlockFamily;
    } }
  | { version: string; exact: false; matches: BlockMatch[]; suggestions?: string[] } {
  const query = q.trim().toLowerCase().replace(/^minecraft:/, "");
  const entry = entries.get(query);
  if (entry) {
    return {
      version: CATALOG_VERSION,
      exact: true,
      block: {
        id: query,
        color: entry.color,
        tone: colorTone(entry.color),
        states: entry.properties ?? emptyAllowed,
        defaults: entry.defaults ?? emptyProperties,
        family: blockFamily(query),
      },
    };
  }
  const tokens = query.split(/[\s_]+/).filter(Boolean);
  const results = matches
    .map((match) => {
      const words = match.id.split("_");
      const tones = match.tone.split(" ");
      if (match.tone === "black") tones.push("dark");
      if (match.tone === "white") tones.push("light");
      if (/(stone|deepslate|basalt|tuff|granite|diorite|andesite|quartz|cinnabar|sulfur|bedrock|obsidian)/.test(match.id)) {
        words.push("stone");
      }
      let score = 0;
      for (const token of tokens) {
        if (words.includes(token)) score += 4;
        else if (tones.includes(token)) score += 2;
        else if (words.some((word) => word.startsWith(token))) score += 1;
        else return { match, score: -1 };
      }
      return { match, score };
    })
    .filter(({ score }) => score >= 0)
    .sort((a, b) => b.score - a.score || a.match.id.length - b.match.id.length ||
      a.match.id.localeCompare(b.match.id))
    .slice(0, 20)
    .map(({ match }) => match);
  return {
    version: CATALOG_VERSION,
    exact: false,
    matches: results,
    ...(results.length ? {} : { suggestions: suggestBlocks(query) }),
  };
}
