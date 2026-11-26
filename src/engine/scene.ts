import { unionBox, type Box } from "./geometry";
import { World } from "./world";

export const ROOT_LABEL = "Ungrouped";

export interface Group {
  name: string;
  /** Index of the parent group. The root is group 0 and has parent -1. */
  parent: number;
}

export interface DisplayPart {
  block: string;
  /** Column-major world transform of the unit block [0,1]³. */
  matrix: number[];
}

export interface Instance {
  id: string;
  model: string;
  tags: string[];
  group: number;
  parts: DisplayPart[];
}

/** The result of one build. Removed groups and instances are null. */
export interface Scene {
  groups: (Group | null)[];
  /** World values are 1-based indices into this list. */
  cells: { state: string; group: number }[];
  world: World;
  instances: (Instance | null)[];
}

/** The stored and transferred form of a scene, with grid blocks as ranges. */
export interface SceneData {
  groups: Group[];
  states: string[];
  /** Flat tuples of x, y, z, length along X, state index and group index. */
  runs: number[];
  instances: Instance[];
}

export const RUN_WIDTH = 6;

export function emptyScene(): Scene {
  return { groups: [{ name: "", parent: -1 }], cells: [], world: new World(), instances: [] };
}

export function groupPath(scene: Scene, id: number): string {
  const names: string[] = [];
  for (let group = scene.groups[id]; group && group.parent >= 0; group = scene.groups[group.parent]) {
    names.push(group.name);
  }
  return names.reverse().join("/");
}

export function encodeScene(scene: Scene): SceneData {
  const renumbered = new Map<number, number>();
  const groups: Group[] = [];
  scene.groups.forEach((group, id) => {
    if (!group) return;
    renumbered.set(id, groups.length);
    groups.push({ name: group.name, parent: group.parent < 0 ? -1 : renumbered.get(group.parent)! });
  });
  const states: string[] = [];
  const stateIndex = new Map<string, number>();
  const cells = scene.cells.map(({ state, group }) => {
    let index = stateIndex.get(state);
    if (index === undefined) {
      index = states.push(state) - 1;
      stateIndex.set(state, index);
    }
    return { state: index, group: renumbered.get(group) ?? 0 };
  });
  const runs: number[] = [];
  scene.world.forEachRun((x, y, z, length, value) => {
    const cell = cells[value - 1];
    runs.push(x, y, z, length, cell.state, cell.group);
  });
  const instances = scene.instances.filter((instance) => instance !== null)
    .map((instance) => ({ ...instance, group: renumbered.get(instance.group)! }));
  return { groups, states, runs, instances };
}

export function decodeScene(data: SceneData): Scene {
  const scene: Scene = { groups: [...data.groups], cells: [], world: new World(Infinity), instances: [...data.instances] };
  const values = new Map<string, number>();
  for (let i = 0; i < data.runs.length; i += RUN_WIDTH) {
    const [x, y, z, length, state, group] = data.runs.slice(i, i + RUN_WIDTH);
    const key = `${state},${group}`;
    let value = values.get(key);
    if (value === undefined) {
      value = scene.cells.push({ state: data.states[state], group });
      values.set(key, value);
    }
    scene.world.fill([x, y, z, x + length - 1, y, z], value, () => {}, () => {});
  }
  return scene;
}

export function* sceneBlocks(data: SceneData): Generator<{ x: number; y: number; z: number; state: string; group: number }> {
  const { runs, states } = data;
  for (let i = 0; i < runs.length; i += RUN_WIDTH) {
    for (let dx = 0; dx < runs[i + 3]; dx++) {
      yield { x: runs[i] + dx, y: runs[i + 1], z: runs[i + 2], state: states[runs[i + 4]], group: runs[i + 5] };
    }
  }
}

export function blockCount(data: SceneData): number {
  let count = 0;
  for (let i = 3; i < data.runs.length; i += RUN_WIDTH) count += data.runs[i];
  return count;
}

/** The cells a display part reaches, from the corners of its transformed unit cube. */
export function partBounds({ matrix: m }: DisplayPart): Box {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let corner = 0; corner < 8; corner++) {
    const x = corner & 1, y = (corner >> 1) & 1, z = corner >> 2;
    for (let axis = 0; axis < 3; axis++) {
      const value = m[axis] * x + m[4 + axis] * y + m[8 + axis] * z + m[12 + axis];
      min[axis] = Math.min(min[axis], value);
      max[axis] = Math.max(max[axis], value);
    }
  }
  const low = min.map((value) => Math.floor(value + 1e-6));
  const high = max.map((value, axis) => Math.max(low[axis], Math.ceil(value - 1e-6) - 1));
  return [low[0], low[1], low[2], high[0], high[1], high[2]];
}

export function instanceBounds(instance: Instance): Box | null {
  return instance.parts.reduce<Box | null>((bounds, part) => unionBox(bounds, partBounds(part)), null);
}

/** Bounds of every group's own blocks and instances plus those of its descendants. */
export function groupBounds(scene: Scene): (Box | null)[] {
  const bounds: (Box | null)[] = scene.groups.map(() => null);
  scene.world.forEachRun((x, y, z, length, value) => {
    const { group } = scene.cells[value - 1];
    bounds[group] = unionBox(bounds[group], [x, y, z, x + length - 1, y, z]);
  });
  for (const instance of scene.instances) {
    if (instance) bounds[instance.group] = unionBox(bounds[instance.group], instanceBounds(instance));
  }
  // Children always come after their parents.
  for (let id = scene.groups.length - 1; id > 0; id--) {
    const group = scene.groups[id];
    if (group) bounds[group.parent] = unionBox(bounds[group.parent], bounds[id]);
  }
  return bounds;
}

export function sceneBounds(data: SceneData): Box | null {
  let bounds: Box | null = null;
  const { runs } = data;
  for (let i = 0; i < runs.length; i += RUN_WIDTH) {
    bounds = unionBox(bounds, [runs[i], runs[i + 1], runs[i + 2], runs[i] + runs[i + 3] - 1, runs[i + 1], runs[i + 2]]);
  }
  for (const instance of data.instances) bounds = unionBox(bounds, instanceBounds(instance));
  return bounds;
}
