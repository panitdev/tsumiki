import type { Box } from "../engine/geometry";
import { ROOT_LABEL, instanceBounds, sceneBlocks, type SceneData } from "../engine/scene";
import { unionBox } from "../engine/geometry";
import { visibleScene, withDescendants } from "../engine/visibility";

/** Tree entries are keyed by group path or instance id, which survive a rebuild. */
export interface TreeNode {
  key: string;
  kind: "group" | "instance";
  /** Index into the scene's groups or instances. */
  index: number;
  label: string;
  detail?: string;
  children: TreeNode[];
}

export function buildTree(data: SceneData): TreeNode[] {
  const paths: string[] = [];
  const nodes: TreeNode[] = data.groups.map((group, index) => {
    paths[index] = index === 0 ? "" : paths[group.parent] ? `${paths[group.parent]}/${group.name}` : group.name;
    return { key: `group:${paths[index]}`, kind: "group", index, label: index === 0 ? ROOT_LABEL : group.name, children: [] };
  });
  const roots: TreeNode[] = [];
  data.groups.forEach((group, index) => {
    if (index === 0) return;
    if (group.parent === 0) roots.push(nodes[index]);
    else nodes[group.parent].children.push(nodes[index]);
  });
  const loose: TreeNode[] = [];
  data.instances.forEach((instance, index) => {
    const node: TreeNode = {
      key: `instance:${instance.id}`, kind: "instance", index, children: [],
      label: instance.id.slice(instance.id.lastIndexOf("/") + 1),
      detail: [`@${instance.model}`, ...instance.tags.map((tag) => `.${tag}`)].join(" "),
    };
    (instance.group === 0 ? loose : nodes[instance.group].children).push(node);
  });
  // "Ungrouped" stands for the root's own blocks and instances.
  let rootBlocks = false;
  for (let i = 5; i < data.runs.length && !rootBlocks; i += 6) rootBlocks = data.runs[i] === 0;
  if (rootBlocks || loose.length) roots.push({ ...nodes[0], children: loose });
  return roots;
}

export function findNode(nodes: readonly TreeNode[], key: string): TreeNode | undefined {
  for (const node of nodes) {
    if (node.key === key) return node;
    const found = findNode(node.children, key);
    if (found) return found;
  }
}

/** The groups a node covers. "Ungrouped" covers the root alone, not the tree below it. */
function covered(data: SceneData, node: TreeNode): Set<number> {
  return node.index === 0 ? new Set([0]) : withDescendants(data, [node.index]);
}

export function nodeBounds(data: SceneData, node: TreeNode): Box | null {
  if (node.kind === "instance") return instanceBounds(data.instances[node.index]);
  const groups = covered(data, node);
  let bounds: Box | null = null;
  for (const { x, y, z, group } of sceneBlocks(data)) {
    if (groups.has(group)) bounds = unionBox(bounds, [x, y, z, x, y, z]);
  }
  for (const instance of data.instances) {
    if (groups.has(instance.group)) bounds = unionBox(bounds, instanceBounds(instance));
  }
  return bounds;
}

/** What the viewer draws after hiding entries, isolating one and cutting to a section. */
export function filterScene(data: SceneData, tree: readonly TreeNode[], hidden: ReadonlySet<string>,
    isolated: string | null, section?: Box) {
  const groups = new Set<number>();
  const instances = new Set<number>();
  for (const key of hidden) {
    const node = findNode(tree, key);
    if (node?.kind === "instance") instances.add(node.index);
    else if (node) for (const id of covered(data, node)) groups.add(id);
  }
  const only = isolated ? findNode(tree, isolated) : undefined;
  if (only?.kind === "group") {
    const kept = covered(data, only);
    data.groups.forEach((_, id) => { if (!kept.has(id)) groups.add(id); });
  } else if (only) {
    data.instances.forEach((_, index) => { if (index !== only.index) instances.add(index); });
  }
  const scene = visibleScene(data, { groups, instances }, section);
  return only?.kind === "instance" ? { ...scene, blocks: [] } : scene;
}

export function blockGroup(data: SceneData, x: number, y: number, z: number): number {
  const { runs } = data;
  for (let i = 0; i < runs.length; i += 6) {
    if (runs[i + 1] === y && runs[i + 2] === z && x >= runs[i] && x < runs[i] + runs[i + 3]) return runs[i + 5];
  }
  return 0;
}
