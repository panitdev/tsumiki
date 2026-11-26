import source from "../../data/blocks.json";
import { editDistance } from "./text";

interface CatalogEntry {
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
    super(`Unknown block "${block}".`, "Check the spelling of the Minecraft Java block ID.");
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

export function suggestBlocks(input: string, limit = 3): string[] {
  const id = blockId(input).toLowerCase().replaceAll(" ", "_");
  if (!id || id.length > 64) return [];
  const words = new Set(id.split("_"));
  const form = id.split("_").at(-1);
  const maximum = Math.max(2, Math.floor(id.length / 4));
  return [...entries.keys()]
    .map((candidate) => {
      const parts = candidate.split("_");
      // An ID made only of the input's words, such as oak_stairs for oak_planks_stairs.
      const contained = parts.length > 1 && parts.every((part) => words.has(part));
      const close = Math.abs(candidate.length - id.length) <= maximum;
      return {
        candidate,
        distance: contained || close ? editDistance(candidate, id) : Infinity,
        rank: contained ? (parts.at(-1) === form ? 0 : 1) : 2,
        contained,
      };
    })
    .filter(({ contained, distance }) => distance <= maximum || (contained && distance < Infinity))
    // A near-miss spelling wins over word overlap.
    .sort((a, b) => Number(a.distance > 2) - Number(b.distance > 2) || a.rank - b.rank ||
      a.distance - b.distance || a.candidate.localeCompare(b.candidate))
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

/** Turns a block's facing, axis or shape clockwise, seen from above. */
export function turnBlock(input: string, quarterTurns: number): string {
  if (!Number.isSafeInteger(quarterTurns)) {
    throw new BlockValidationError("Invalid number of quarter turns.", "Pass a whole number; 1 is 90 degrees clockwise.");
  }
  const { id, properties, defaults } = parseBlock(input);
  const entry = entries.get(id)!;
  if (!entry.turns || !entry.properties) return formatBlock(id, properties, defaults);

  const dimensions = Object.entries(entry.properties);
  let index = 0;
  for (const [name, allowed] of dimensions) {
    index = index * allowed.length + allowed.indexOf(properties[name] ?? defaults[name]);
  }
  const [quarterTurn] = entry.turns;
  if (quarterTurn >= 0) {
    for (let i = 0; i < ((quarterTurns % 4) + 4) % 4; i++) index = catalog.turns[quarterTurn][index];
  }

  for (let i = dimensions.length - 1; i >= 0; i--) {
    const [name, allowed] = dimensions[i];
    properties[name] = allowed[index % allowed.length];
    index = Math.floor(index / allowed.length);
  }
  return formatBlock(id, properties, defaults);
}
