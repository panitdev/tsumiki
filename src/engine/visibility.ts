import { unionBox, type Box, type Position } from "./geometry";
import { partBounds, sceneBlocks, type SceneData } from "./scene";
import type { Selection } from "./selector";

export interface VisibleBlock {
  x: number;
  y: number;
  z: number;
  state: string;
  group: number;
}

export interface VisibleDisplay {
  block: string;
  matrix: number[];
  /** Index into the scene's instances. */
  instance: number;
}

export interface Hidden {
  groups: ReadonlySet<number>;
  instances: ReadonlySet<number>;
}

/** The selected groups together with all their descendants. */
export function withDescendants(data: SceneData, ids: Iterable<number>): Set<number> {
  const groups = new Set(ids);
  // Parents always come before their children.
  data.groups.forEach((group, id) => {
    if (groups.has(group.parent)) groups.add(id);
  });
  return groups;
}

export function hiddenBy(data: SceneData, selection: Selection): Hidden {
  return { groups: withDescendants(data, selection.groups), instances: new Set(selection.instances) };
}

/**
 * What remains of a build after hiding groups and instances and cutting it to a section.
 * A block display stays when its centre is inside the section.
 */
export function visibleScene(data: SceneData, hidden?: Hidden, section?: Box) {
  const blocks: VisibleBlock[] = [];
  const displays: VisibleDisplay[] = [];
  let bounds: Box | null = null;
  const inside = ([x, y, z]: Position) => !section ||
    (x >= section[0] && x <= section[3] && y >= section[1] && y <= section[4] && z >= section[2] && z <= section[5]);
  for (const block of sceneBlocks(data)) {
    const { x, y, z, group } = block;
    if (hidden?.groups.has(group) || !inside([x, y, z])) continue;
    blocks.push(block);
    bounds = unionBox(bounds, [x, y, z, x, y, z]);
  }
  data.instances.forEach(({ group, parts }, instance) => {
    if (hidden?.groups.has(group) || hidden?.instances.has(instance)) return;
    for (const part of parts) {
      const { matrix: m } = part;
      const centre = [0, 1, 2].map((axis) => Math.floor((m[axis] + m[4 + axis] + m[8 + axis]) / 2 + m[12 + axis]));
      if (!inside(centre as Position)) continue;
      displays.push({ block: part.block, matrix: m, instance });
      bounds = unionBox(bounds, partBounds(part));
    }
  });
  return { blocks, displays, bounds };
}
