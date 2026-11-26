import { editDistance } from "./text";
import type { Group, Instance } from "./scene";

export class SelectorError extends Error {
  constructor(message: string, readonly hint: string) {
    super(message);
  }
}

interface Compound {
  /** A group name. */
  group?: string;
  model: string[];
  tag: string[];
  id: string[];
}

interface Step {
  compound: Compound;
  /** How this step relates to the one before it. */
  direct: boolean;
}

export interface Selectable {
  groups: readonly (Group | null)[];
  instances: readonly (Instance | null)[];
}

export interface Selection {
  /** Indices into `groups` and `instances`. */
  groups: number[];
  instances: number[];
}

const SYNTAX = 'Use a group name, @model, .tag or #id, joined by a space (descendant) or > (child). Quote names with spaces: "Market Street".';

export function parseSelector(selector: string): Step[] {
  const steps: Step[] = [];
  let at = 0;
  let direct = false;
  const fail = (): never => {
    throw new SelectorError(`Invalid selector ${JSON.stringify(selector)}.`, SYNTAX);
  };
  const space = () => {
    const start = at;
    while (/\s/.test(selector[at] ?? "")) at++;
    return at > start;
  };
  const name = (): string => {
    const quote = selector[at];
    if (quote === '"' || quote === "'") {
      const end = selector.indexOf(quote, at + 1);
      if (end <= at + 1) fail();
      const value = selector.slice(at + 1, end);
      at = end + 1;
      return value;
    }
    const match = /^[^\s>.@#"',[\]]+/.exec(selector.slice(at));
    if (!match) return fail();
    at += match[0].length;
    return match[0];
  };
  space();
  while (at < selector.length) {
    const compound: Compound = { model: [], tag: [], id: [] };
    if (!"@.#".includes(selector[at])) compound.group = name();
    while (at < selector.length && "@.#".includes(selector[at])) {
      const kind = selector[at++];
      compound[kind === "@" ? "model" : kind === "." ? "tag" : "id"].push(name());
    }
    steps.push({ compound, direct });
    const spaced = space();
    direct = selector[at] === ">";
    if (direct) {
      at++;
      space();
      if (at >= selector.length) fail();
    } else if (!spaced && at < selector.length) fail();
  }
  if (!steps.length) fail();
  return steps;
}

export function select(scene: Selectable, selector: string): Selection {
  const steps = parseSelector(selector);

  const isInstanceStep = ({ model, tag, id }: Compound) => model.length + tag.length + id.length > 0;
  const matchesGroup = (compound: Compound, id: number) =>
    id > 0 && !isInstanceStep(compound) && scene.groups[id]?.name === compound.group;
  const matchesInstance = (compound: Compound, instance: Instance) => compound.group === undefined &&
    compound.model.every((model) => instance.model === model) &&
    compound.tag.every((tag) => instance.tags.includes(tag)) &&
    compound.id.every((id) => instance.id === id);

  // Only groups can be ancestors. Walks up from `parent` looking for steps[index].
  const ancestors = (index: number, parent: number, direct: boolean): boolean => {
    if (index < 0) return true;
    for (let id = parent; id > 0; id = scene.groups[id]!.parent) {
      if (matchesGroup(steps[index].compound, id) &&
          ancestors(index - 1, scene.groups[id]!.parent, steps[index].direct)) return true;
      if (direct) return false;
    }
    return false;
  };

  const last = steps.length - 1;
  const { compound, direct } = steps[last];
  const result: Selection = { groups: [], instances: [] };
  scene.groups.forEach((group, id) => {
    if (group && matchesGroup(compound, id) && ancestors(last - 1, group.parent, direct)) result.groups.push(id);
  });
  scene.instances.forEach((instance, index) => {
    if (instance && matchesInstance(compound, instance) && ancestors(last - 1, instance.group, direct)) {
      result.instances.push(index);
    }
  });
  return result;
}

/** Explains an empty selection, suggesting close names for the parts that match nothing. */
export function explainEmpty(scene: Selectable, selector: string): SelectorError {
  const instances = scene.instances.filter((instance) => instance !== null);
  const names = {
    group: [...new Set(scene.groups.flatMap((group, id) => (group && id > 0 ? [group.name] : [])))],
    model: [...new Set(instances.map((instance) => instance.model))],
    tag: [...new Set(instances.flatMap((instance) => instance.tags))],
    id: instances.map((instance) => instance.id),
  };
  const prefixes = { group: "", model: "@", tag: ".", id: "#" };
  const suggestions: string[] = [];
  for (const { compound } of parseSelector(selector)) {
    for (const kind of ["group", "model", "tag", "id"] as const) {
      for (const wanted of [compound[kind] ?? []].flat()) {
        if (names[kind].includes(wanted)) continue;
        const limit = Math.max(2, Math.ceil(wanted.length / 3));
        const close = names[kind]
          .map((candidate) => ({ candidate, distance: editDistance(candidate.toLowerCase(), wanted.toLowerCase()) }))
          .filter(({ distance }) => distance <= limit)
          .sort((a, b) => a.distance - b.distance || a.candidate.localeCompare(b.candidate))
          .slice(0, 3)
          .map(({ candidate }) => `${prefixes[kind]}${/[\s>.@#,[\]]/.test(candidate) ? `"${candidate}"` : candidate}`);
        suggestions.push(...close);
      }
    }
  }
  return new SelectorError(
    `Nothing matches ${JSON.stringify(selector)}.`,
    suggestions.length ? `Did you mean ${suggestions.join(", ")}?` : "Log select(...) to see what exists.",
  );
}
