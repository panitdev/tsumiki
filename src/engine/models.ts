import { mat4, type ReadonlyMat4 } from "gl-matrix";
import { BlockValidationError, isAir, normalizeBlock } from "./catalog";
import type { Position } from "./geometry";
import type { DisplayPart } from "./scene";

const MAX_DEPTH = 32;
const MAX_COORDINATE = 30_000_000;

export interface Transform {
  at: Position;
  rotate: Position;
  scale: Position;
}

export interface Part extends Transform {
  block?: string;
  model?: string;
  children: Part[];
}

export interface Model {
  parts: Part[];
  tags: string[];
}

function fail(message: string, hint: string): never {
  throw new BlockValidationError(message, hint);
}

function vector(value: unknown, label: string): Position {
  if (!Array.isArray(value) || value.length !== 3 ||
      !value.every((item) => typeof item === "number" && Number.isFinite(item) && Math.abs(item) <= MAX_COORDINATE)) {
    fail(`${label} must be three finite numbers.`, `Write it as ${label}: [x, y, z].`);
  }
  return value as Position;
}

export function parseTransform(input: Record<string, unknown>, label: string): Transform {
  const scale = input.scale ?? 1;
  return {
    at: vector(input.at, `${label} at`),
    rotate: vector(input.rotate ?? [0, 0, 0], `${label} rotate`),
    scale: vector(typeof scale === "number" ? [scale, scale, scale] : scale, `${label} scale`),
  };
}

export function parseTags(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((tag) => typeof tag === "string" && /^[^\s"']{1,80}$/.test(tag))) {
    fail("tags must be a list of strings without spaces or quotes.", 'Write tags: ["light"].');
  }
  return value as string[];
}

export function object(value: unknown, label: string, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object.`, `Its keys are ${keys.join(", ")}.`);
  }
  const unknown = Object.keys(value).find((key) => !keys.includes(key));
  if (unknown !== undefined) fail(`Unknown ${label} key "${unknown}".`, `Its keys are ${keys.join(", ")}.`);
  return value as Record<string, unknown>;
}

export function parseParts(value: unknown, depth = 0): Part[] {
  if (!Array.isArray(value)) fail("Model parts must be a list.", 'Write [{ block: "lantern", at: [0, 0, 0] }].');
  if (depth > MAX_DEPTH) fail("Model parts are nested too deeply.", `Use at most ${MAX_DEPTH} levels of children.`);
  return value.map((item) => {
    const input = object(item, "part", ["block", "model", "at", "rotate", "scale", "children"]);
    const { block, model, children } = input;
    if (block !== undefined && model !== undefined) {
      fail("A part cannot have both block and model.", "Move one of them into a child part.");
    }
    if (block === undefined && model === undefined && children === undefined) {
      fail("A part needs a block, a model or children.", "A pivot-only part holds other parts in children.");
    }
    if (block !== undefined && typeof block !== "string") fail("A part's block must be a string.", 'Write block: "lantern".');
    if (model !== undefined && typeof model !== "string") fail("A part's model must be a model name.", 'Write model: "lamp".');
    if (typeof block === "string" && isAir(block)) fail("A display part cannot be air.", "Remove the part.");
    return {
      ...parseTransform(input, "part"),
      block: block === undefined ? undefined : normalizeBlock(block),
      model: model as string | undefined,
      children: children === undefined ? [] : parseParts(children, depth + 1),
    };
  });
}

/**
 * Translate to `at`, then rotate and scale about it. Rotation is in degrees, applied
 * about X, then Y, then Z (fixed axes). A positive angle is clockwise seen from the
 * positive end of its axis, so +90 about Y matches turn(block, 1).
 * Plain arrays keep double precision far from the origin.
 */
export function compose(parent: ReadonlyMat4, { at, rotate, scale }: Transform): number[] {
  const out = identity();
  const local = identity();
  const m = local as unknown as mat4;
  mat4.translate(m, m, at);
  const radians = -Math.PI / 180;
  mat4.rotateZ(m, m, rotate[2] * radians);
  mat4.rotateY(m, m, rotate[1] * radians);
  mat4.rotateX(m, m, rotate[0] * radians);
  mat4.scale(m, m, scale);
  mat4.multiply(out as unknown as mat4, parent, m);
  return out;
}

export function identity(): number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function displayMatrix(world: number[]): number[] {
  // A block part is centred on its `at`.
  const out = identity();
  mat4.translate(out as unknown as mat4, world as unknown as mat4, [-0.5, -0.5, -0.5]);
  return out.map((value) => Math.round(value * 1e9) / 1e9 + 0);
}

export function unknownModel(name: string, models: ReadonlyMap<string, Model>): BlockValidationError {
  const known = [...models.keys()];
  return new BlockValidationError(`Unknown model "${name}".`,
    known.length ? `Defined models are ${known.slice(0, 20).join(", ")}.` : "Define it with model(name, parts) first.");
}

/** Expands a model into one display part per block, calling `visit` for every node so the caller can bound the work. */
export function flatten(models: ReadonlyMap<string, Model>, name: string, root: number[], visit: (isBlock: boolean) => void): DisplayPart[] {
  const output: DisplayPart[] = [];
  const stack: string[] = [];
  const expand = (modelName: string, parent: number[]) => {
    const model = models.get(modelName);
    if (!model) throw unknownModel(modelName, models);
    if (stack.includes(modelName)) {
      fail(`Recursive model: ${[...stack, modelName].join(" → ")}.`, "A model cannot contain itself.");
    }
    if (stack.length >= MAX_DEPTH) fail("Models are nested too deeply.", `Use at most ${MAX_DEPTH} levels.`);
    stack.push(modelName);
    walk(model.parts, parent);
    stack.pop();
  };
  const walk = (parts: Part[], parent: number[]) => {
    for (const part of parts) {
      visit(part.block !== undefined);
      const world = compose(parent as unknown as mat4, part);
      if (part.block !== undefined) output.push({ block: part.block, matrix: displayMatrix(world) });
      if (part.model !== undefined) expand(part.model, world);
      walk(part.children, world);
    }
  };
  expand(name, root);
  return output;
}

/** Finds references to models that never got defined, and cycles, including in unused models. */
export function validateModel(models: ReadonlyMap<string, Model>, name: string, checked: Set<string>, stack: string[] = []): void {
  if (stack.includes(name)) fail(`Recursive model: ${[...stack, name].join(" → ")}.`, "A model cannot contain itself.");
  if (checked.has(name)) return;
  const model = models.get(name);
  if (!model) throw unknownModel(name, models);
  if (stack.length >= MAX_DEPTH) fail("Models are nested too deeply.", `Use at most ${MAX_DEPTH} levels.`);
  const walk = (parts: Part[]) => {
    for (const part of parts) {
      if (part.model !== undefined) validateModel(models, part.model, checked, [...stack, name]);
      walk(part.children);
    }
  };
  walk(model.parts);
  checked.add(name);
}
