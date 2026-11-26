import type { BuildResult } from "./build";
import { ROOT_LABEL, groupPath, type Scene } from "./scene";

const LISTED_GROUPS = 5;

export interface SceneDiff {
  /** Cells that are new or hold a different state. */
  added: number;
  removed: number;
  displaysAdded: number;
  displaysRemoved: number;
  /** Outermost groups whose own blocks or instances changed. */
  rebuilt: string[];
}

function hashString(text: string, seed: number): number {
  let hash = 0x811c9dc5 ^ seed;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return hash >>> 0;
}

function mix(hash: number, value: number): number {
  hash = Math.imul(hash ^ value, 0x85ebca6b);
  return (hash ^ (hash >>> 13)) >>> 0;
}

/** An order-independent signature of each group's own contents, by path. */
class Signatures {
  private readonly groups = new Map<string, [number, number, number]>();

  add(path: string, first: number, second: number) {
    let signature = this.groups.get(path);
    if (!signature) this.groups.set(path, signature = [0, 0, 0]);
    signature[0] = (signature[0] + first) >>> 0;
    signature[1] = (signature[1] + second) >>> 0;
    signature[2]++;
  }

  differences(other: Signatures): Set<string> {
    const paths = new Set<string>();
    for (const path of new Set([...this.groups.keys(), ...other.groups.keys()])) {
      const a = this.groups.get(path), b = other.groups.get(path);
      if (!a || !b || a.some((value, i) => value !== b[i])) paths.add(path);
    }
    return paths;
  }
}

function inspect(scene: Scene, visit: (x: number, y: number, z: number, state: string) => void) {
  const signatures = new Signatures();
  const paths = scene.cells.map(({ group }) => groupPath(scene, group));
  const hashes = scene.cells.map(({ state }) => [hashString(state, 1), hashString(state, 2)]);
  scene.world.forEach((x, y, z, value) => {
    const [first, second] = hashes[value - 1];
    signatures.add(paths[value - 1], mix(mix(mix(first, x), y), z), mix(mix(mix(second, z), x), y));
    visit(x, y, z, scene.cells[value - 1].state);
  });
  const displays = new Map<string, number>();
  for (const instance of scene.instances) {
    if (!instance) continue;
    const path = groupPath(scene, instance.group);
    const text = JSON.stringify([instance.id, instance.model, instance.tags, instance.parts]);
    signatures.add(path, hashString(text, 1), hashString(text, 2));
    for (const part of instance.parts) {
      const key = `${part.block} ${part.matrix.join(",")}`;
      displays.set(key, (displays.get(key) ?? 0) + 1);
    }
  }
  return { signatures, displays };
}

function surplus(from: Map<string, number>, over: Map<string, number>): number {
  let count = 0;
  for (const [key, amount] of from) count += Math.max(0, amount - (over.get(key) ?? 0));
  return count;
}

export function diffScenes(before: Scene, after: Scene): SceneDiff {
  let added = 0;
  let removed = 0;
  const stateAt = (scene: Scene, x: number, y: number, z: number) => {
    const value = scene.world.get(x, y, z);
    return value ? scene.cells[value - 1].state : undefined;
  };
  const next = inspect(after, (x, y, z, state) => {
    if (stateAt(before, x, y, z) !== state) added++;
  });
  const previous = inspect(before, (x, y, z) => {
    if (!after.world.get(x, y, z)) removed++;
  });
  const changed = next.signatures.differences(previous.signatures);
  const rebuilt = [...changed].filter((path) => {
    const names = path.split("/");
    return !names.some((_, i) => i > 0 && changed.has(names.slice(0, i).join("/")));
  }).sort().map((path) => path || ROOT_LABEL);
  return {
    added, removed, rebuilt,
    displaysAdded: surplus(next.displays, previous.displays),
    displaysRemoved: surplus(previous.displays, next.displays),
  };
}

const count = (value: number) => value.toLocaleString("en-US");

/** The text appended to bash output after a build. `diff` is required for a successful build. */
export function formatReport(result: BuildResult, milliseconds: number, diff?: SceneDiff): string {
  const lines: string[] = [];
  if (result.ok) {
    const summary: string[] = [];
    if (diff!.added || diff!.removed) summary.push(`+${count(diff!.added)} −${count(diff!.removed)} blocks`);
    if (diff!.displaysAdded || diff!.displaysRemoved) {
      summary.push(`+${count(diff!.displaysAdded)} −${count(diff!.displaysRemoved)} block displays`);
    }
    if (diff!.rebuilt.length) {
      const extra = diff!.rebuilt.length - LISTED_GROUPS;
      summary.push(`${diff!.rebuilt.slice(0, LISTED_GROUPS).join(", ")}${extra > 0 ? ` and ${extra} more` : ""} rebuilt`);
    }
    lines.push(`[build ok · ${Math.round(milliseconds)} ms] ${summary.join(" · ") || "no changes"}`);
    lines.push(...result.warnings.map((warning) => `warn: ${warning}`));
  } else {
    lines.push(`[build failed] ${result.line ? `build.js:${result.line} ` : ""}${result.error}`);
  }
  lines.push(...result.logs.map((line) => `log: ${line}`));
  return lines.join("\n");
}
