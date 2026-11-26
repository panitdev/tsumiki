import { DefaultIntrinsics, getQuickJS, type QuickJSContext, type QuickJSHandle } from "quickjs-emscripten";
import { bootstrap } from "./bootstrap";
import { BlockValidationError, UnknownBlockError, isAir, normalizeBlock, turnBlock } from "./catalog";
import { normalizeBox, type Box, type Position } from "./geometry";
import {
  compose, flatten, identity, object, parseParts, parseTags, parseTransform, unknownModel, validateModel,
  type Model,
} from "./models";
import { groupRandom } from "./random";
import { ROOT_LABEL, emptyScene, groupBounds, groupPath, instanceBounds, type Scene } from "./scene";
import { SelectorError, explainEmpty, select, type Selection } from "./selector";
import { WorldTooSparseError } from "./world";

export const MAX_SOURCE_BYTES = 262_144;
const MAX_WRITES = 2_000_000;
const TIME_LIMIT = 10_000;
const MAX_COORDINATE = 30_000_000;
const MAX_STRING = 4_096;
const MAX_DATA = 262_144;
const MAX_GROUPS = 10_000;
const MAX_MODELS = 1_000;
const MAX_INSTANCES = 10_000;
const MAX_DISPLAY_PARTS = 20_000;
const MAX_MODEL_NODES = 200_000;
const MAX_SELECTIONS = 10_000;
const MAX_LOGS = 100;
const WARNING_LIMIT = 20;
const SCRIPT_FILENAME = "build.js";

export interface BuildFailure {
  ok: false;
  error: string;
  line?: number;
  logs: string[];
}

export interface BuildSuccess {
  ok: true;
  scene: Scene;
  logs: string[];
  warnings: string[];
}

export type BuildResult = BuildSuccess | BuildFailure;

function lineNumber(stack: string): number | undefined {
  const frame = /\bbuild\.js:(\d+)/.exec(stack);
  return frame ? Number(frame[1]) : undefined;
}

function sentence(message: string, hint: string): string {
  return hint ? `${message.replace(/[.\s]+$/, "")}. ${hint}` : message;
}

function describeError(error: BlockValidationError | SelectorError): { message: string; hint: string } {
  if (error instanceof UnknownBlockError) {
    const [best] = error.suggestions;
    return { message: `unknown block "${error.block}"${best ? `, did you mean "${best}"?` : ""}`, hint: "" };
  }
  return { message: error.message, hint: error.hint };
}

/** Runs build.js from scratch. The result depends only on the source. */
export async function runBuild(source: string): Promise<BuildResult> {
  const logs: string[] = [];
  if (Buffer.byteLength(source) > MAX_SOURCE_BYTES) {
    return { ok: false, error: `build.js is larger than ${MAX_SOURCE_BYTES} bytes. Use loops and functions to shorten it.`, logs };
  }

  const QuickJS = await getQuickJS();
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(64 * 1024 * 1024);
  runtime.setMaxStackSize(512 * 1024);
  // Promise stays an intrinsic: QuickJS aborts on async syntax without it.
  const vm = runtime.newContext({ intrinsics: { ...DefaultIntrinsics, Date: false } });

  const scene = emptyScene();
  const { world, groups, cells, instances } = scene;
  const stack = [0];
  const paths = [""];
  const children = new Map<string, number>();
  const values = new Map<string, number>();
  const states = new Map<string, string>();
  const generators = new Map<string, () => number>();
  const models = new Map<string, Model>();
  const modelLines = new Map<string, number | undefined>();
  const instanceCounts = new Map<string, number>();
  const ids = new Set<string>();
  const selections: Selection[] = [];
  const overwritten = new Map<number, number>();
  const warnings = new Map<string, { line: number | undefined; victim: string; count: number }>();
  let bounds: ReturnType<typeof groupBounds> | undefined;
  let writes = 0;
  let parts = 0;
  let nodes = 0;
  let fatal: { error: string; line?: number } | undefined;
  const deadline = performance.now() + TIME_LIMIT;

  const timeout = () => {
    if (performance.now() < deadline) return false;
    fatal ??= { error: `The build exceeded ${TIME_LIMIT / 1000} seconds.` };
    return true;
  };
  runtime.setInterruptHandler(timeout);
  const tick = () => {
    if (timeout()) throw new BlockValidationError(fatal!.error, "");
  };

  const limit = (message: string, hint: string): never => {
    fatal ??= { error: sentence(message, hint) };
    throw new BlockValidationError(message, hint);
  };

  const currentGroup = () => stack[stack.length - 1];
  const currentPath = () => paths[paths.length - 1];

  function string(handle: QuickJSHandle | undefined, label: string, max = MAX_STRING): string {
    if (!handle || vm.typeof(handle) !== "string") {
      throw new BlockValidationError(`${label} must be a string.`, "");
    }
    const length = vm.getProp(handle, "length").consume((value) => vm.getNumber(value));
    if (length > max) throw new BlockValidationError(`${label} is too long.`, `Use at most ${max} characters.`);
    const input = vm.getString(handle);
    if (input.length !== length) throw new BlockValidationError(`${label} contains invalid characters.`, "");
    return input;
  }
  function data(handle: QuickJSHandle | undefined, label: string): unknown {
    return JSON.parse(string(handle, label, MAX_DATA));
  }
  function coordinate(handle: QuickJSHandle | undefined): number {
    const value = handle && vm.typeof(handle) === "number" ? vm.getNumber(handle) : NaN;
    if (!Number.isInteger(value) || Math.abs(value) > MAX_COORDINATE) {
      throw new BlockValidationError("Block coordinates must be integers.",
        "Round computed positions with Math.round or Math.floor and stay within ±30,000,000.");
    }
    return value;
  }
  function point(handle: QuickJSHandle | undefined): Position {
    if (!handle || vm.typeof(handle) !== "object" || vm.getLength(handle) !== 3) {
      throw new BlockValidationError("A point must be [x, y, z].", "Write fill([x1, y1, z1], [x2, y2, z2], block).");
    }
    return [0, 1, 2].map((axis) => vm.getProp(handle, axis).consume(coordinate)) as Position;
  }
  /** The normalized state, or "air". Unknown IDs fail the build. */
  function blockState(handle: QuickJSHandle | undefined): string {
    // Called once per set(), so skip string()'s extra round trip for its NUL check.
    if (!handle || vm.typeof(handle) !== "string") throw new BlockValidationError("A block must be a string.", "");
    const input = vm.getString(handle);
    let state = states.get(input);
    if (state === undefined) {
      if (input.length > MAX_STRING) throw new BlockValidationError("A block is too long.", "");
      const normalized = normalizeBlock(input);
      state = isAir(normalized) ? "air" : normalized;
      if (states.size < 10_000) states.set(input, state);
    }
    return state;
  }
  /** The world value for a state placed in the current group; zero for air. */
  function cellValue(state: string): number {
    if (state === "air") return 0;
    const group = currentGroup();
    const key = `${group} ${state}`;
    let value = values.get(key);
    if (value === undefined) {
      value = cells.push({ state, group });
      values.set(key, value);
    }
    return value;
  }
  function reserve(count: number) {
    writes += count;
    if (writes > MAX_WRITES) limit("The build exceeded 2,000,000 block writes.", "Fill fewer or smaller regions.");
  }

  // Replacing another group's block is reported. Carving it out with air is ordinary layering.
  const replaced = (placing: number) => (previous: number, count: number) => {
    const { group } = cells[previous - 1];
    if (placing && group !== currentGroup()) overwritten.set(group, (overwritten.get(group) ?? 0) + count);
  };
  // An error built by the host has no guest frames, so ask the guest for its stack.
  const traceFunction = vm.unwrapResult(vm.evalCode("(() => { const E = Error; return () => new E().stack; })()", "api.js", { type: "global" }));
  function callerLine(): number | undefined {
    const result = vm.callFunction(traceFunction, vm.undefined);
    if (result.error) {
      result.error.dispose();
      return undefined;
    }
    return result.value.consume((stack) => lineNumber(vm.getString(stack)));
  }
  function recordOverwrites() {
    if (!overwritten.size) return;
    const line = callerLine();
    for (const [group, count] of overwritten) {
      const victim = groupPath(scene, group) || ROOT_LABEL;
      const key = `${line} ${victim}`;
      const warning = warnings.get(key);
      if (warning) warning.count += count;
      else warnings.set(key, { line, victim, count });
    }
    overwritten.clear();
  }

  function register(name: string, callback: (...args: QuickJSHandle[]) => QuickJSHandle | void): void {
    vm.newFunction(name, (...args) => {
      try {
        if (fatal || timeout()) throw new BlockValidationError(fatal!.error, "");
        return callback(...args);
      } catch (error) {
        let described: { message: string; hint: string };
        if (error instanceof WorldTooSparseError) {
          fatal ??= {
            error: "The build has more than 8,192 partly filled 16×16×16 sections. Keep scattered blocks closer together.",
          };
          described = { message: fatal.error, hint: "" };
        } else if (error instanceof BlockValidationError || error instanceof SelectorError) {
          described = describeError(error);
        } else throw error;
        if (fatal && fatal.line === undefined) fatal.line = callerLine();
        const exception = vm.newError(described.message);
        vm.newString(described.hint).consume((hint) => vm.setProp(exception, "hint", hint));
        return { error: exception };
      }
    }).consume((fn) => vm.setProp(vm.global, name, fn));
  }

  const removed = (selection: Selection) => {
    const doomed = new Set(selection.groups);
    // Parents always come before their children.
    groups.forEach((group, id) => {
      if (group && doomed.has(group.parent)) doomed.add(id);
    });
    if (doomed.size) {
      world.erase((value) => doomed.has(cells[value - 1].group), tick);
    }
    const gone = new Set(selection.instances);
    instances.forEach((instance, index) => {
      if (instance && (gone.has(index) || doomed.has(instance.group))) {
        ids.delete(instance.id);
        instances[index] = null;
      }
    });
    // Groups that are still running stay in the tree, emptied.
    for (const id of doomed) {
      const group = groups[id];
      if (!group || stack.includes(id)) continue;
      children.delete(`${group.parent} ${group.name}`);
      groups[id] = null;
    }
    bounds = undefined;
  };

  try {
    register("set", (x, y, z, block) => {
      const [px, py, pz] = [coordinate(x), coordinate(y), coordinate(z)];
      reserve(1);
      const value = cellValue(blockState(block));
      const previous = world.set(px, py, pz, value);
      if (previous) replaced(value)(previous, 1);
      bounds = undefined;
      recordOverwrites();
    });
    register("fill", (from, to, block) => {
      const box = normalizeBox([...point(from), ...point(to)] as Box);
      const state = blockState(block);
      reserve((box[3] - box[0] + 1) * (box[4] - box[1] + 1) * (box[5] - box[2] + 1));
      const value = cellValue(state);
      world.fill(box, value, replaced(value), tick);
      bounds = undefined;
      recordOverwrites();
    });
    register("get", (x, y, z) => {
      const value = world.get(coordinate(x), coordinate(y), coordinate(z));
      return vm.newString(value ? cells[value - 1].state : "air");
    });
    register("turn", (block, quarterTurns) => {
      const turns = quarterTurns && vm.typeof(quarterTurns) === "number" ? vm.getNumber(quarterTurns) : NaN;
      return vm.newString(turnBlock(string(block, "A block"), turns));
    });
    register("rand", () => {
      const path = currentPath();
      let generator = generators.get(path);
      if (!generator) generators.set(path, generator = groupRandom(path));
      return vm.newNumber(generator());
    });
    register("__log", (line) => {
      if (logs.length < MAX_LOGS) logs.push(vm.getString(line));
      else if (logs.length === MAX_LOGS) logs.push("[more log lines omitted]");
    });
    register("__enter", (handle) => {
      const name = string(handle, "A group name", 80);
      if (!name.trim() || name !== name.trim() || /[/"'\u0000-\u001f\u007f]/u.test(name)) {
        throw new BlockValidationError(`Invalid group name ${JSON.stringify(name)}.`,
          "Use a name without slashes, quotes or surrounding spaces, and nest group() calls for a path.");
      }
      const parent = currentGroup();
      const key = `${parent} ${name}`;
      let id = children.get(key);
      if (id === undefined) {
        if (groups.length > MAX_GROUPS) limit("The build has too many groups.", `Use at most ${MAX_GROUPS}.`);
        id = groups.push({ name, parent }) - 1;
        children.set(key, id);
      }
      paths.push(currentPath() ? `${currentPath()}/${name}` : name);
      stack.push(id);
    });
    register("__exit", () => {
      if (stack.length > 1) {
        stack.pop();
        paths.pop();
      }
    });
    register("__model", (nameHandle, partsHandle, optionsHandle) => {
      const name = string(nameHandle, "A model name", 80);
      if (!/^[^\s>.@#"',[\]/]+$/.test(name)) {
        throw new BlockValidationError(`Invalid model name ${JSON.stringify(name)}.`,
          "Use letters, digits, hyphens and underscores.");
      }
      if (models.has(name)) throw new BlockValidationError(`Model "${name}" is already defined.`, "Give each model its own name.");
      if (models.size >= MAX_MODELS) limit("The build defines too many models.", `Use at most ${MAX_MODELS}.`);
      const options = object(data(optionsHandle, "model options") ?? {}, "model option", ["tags"]);
      models.set(name, { parts: parseParts(data(partsHandle, "Model parts")), tags: parseTags(options.tags) });
      modelLines.set(name, callerLine());
    });
    register("__use", (nameHandle, optionsHandle) => {
      const name = string(nameHandle, "A model name", 80);
      const model = models.get(name);
      if (!model) throw unknownModel(name, models);
      const options = object(data(optionsHandle, "use options"), "use option", ["at", "rotate", "scale", "id", "tags"]);
      const root = compose(identity() as never, parseTransform(options, "use"));
      if (instances.length >= MAX_INSTANCES) limit("The build places too many instances.", `Use at most ${MAX_INSTANCES}.`);
      let id = options.id;
      if (id === undefined) {
        const prefix = currentPath() ? `${currentPath()}/${name}` : name;
        let count = instanceCounts.get(prefix) ?? 0;
        do id = `${prefix}-${++count}`;
        while (ids.has(id as string));
        instanceCounts.set(prefix, count);
      } else if (typeof id !== "string" || !id || id.length > 200 || /["'\u0000-\u001f]/.test(id)) {
        throw new BlockValidationError("An instance id must be a non-empty string without quotes.", "");
      } else if (ids.has(id)) {
        throw new BlockValidationError(`Duplicate instance id "${id}".`, "Give each instance its own id.");
      }
      const flattened = flatten(models, name, root, (isBlock) => {
        if (++nodes > MAX_MODEL_NODES) limit("Models expand into too many parts.", "Simplify nested models.");
        if (isBlock && ++parts > MAX_DISPLAY_PARTS) {
          limit("The build has too many block displays.", `Use at most ${MAX_DISPLAY_PARTS} block parts in total.`);
        }
        if ((nodes & 255) === 0) tick();
      });
      ids.add(id as string);
      instances.push({
        id: id as string, model: name, group: currentGroup(), parts: flattened,
        tags: [...new Set([...model.tags, ...parseTags(options.tags)])],
      });
      bounds = undefined;
      return vm.newString(id as string);
    });
    register("__select", (handle) => {
      const found = select(scene, string(handle, "A selector"));
      if (selections.length >= MAX_SELECTIONS) limit("The build calls select too many times.", "Reuse a selection.");
      // An empty selection keeps its selector so that remove() can explain it.
      const empty = !found.groups.length && !found.instances.length;
      const selector = empty ? vm.getString(handle) : undefined;
      const index = selections.push(Object.assign(found, { selector })) - 1;
      const matches = [
        ...found.groups.map((id) => ({ kind: "group", path: groupPath(scene, id) })),
        ...found.instances.map((id) => {
          const { id: instanceId, model, tags, group } = instances[id]!;
          return { kind: "instance", id: instanceId, model, tags, path: groupPath(scene, group) };
        }),
      ];
      return vm.newString(JSON.stringify({ handle: index, matches }));
    });
    register("__bounds", (handle, position) => {
      const selection = selections[vm.getNumber(handle)];
      const index = vm.getNumber(position);
      let box: Box | null = null;
      if (index < selection.groups.length) {
        bounds ??= groupBounds(scene);
        box = bounds[selection.groups[index]] ?? null;
      } else {
        const instance = instances[selection.instances[index - selection.groups.length]];
        box = instance ? instanceBounds(instance) : null;
      }
      return vm.newString(JSON.stringify(box && [box.slice(0, 3), box.slice(3)]));
    });
    register("__remove", (handle) => {
      const selection = selections[vm.getNumber(handle)] as Selection & { selector?: string };
      if (selection.selector !== undefined) throw explainEmpty(scene, selection.selector);
      removed(selection);
    });

    const describe = vm.unwrapResult(vm.evalCode(bootstrap, "api.js", { type: "global" }));
    const guestFailure = (exception: QuickJSHandle): BuildFailure => {
      const [message, trace, hint] = describeThrown(vm, describe, exception);
      return { ok: false, error: sentence(message, hint), line: lineNumber(trace), logs };
    };
    try {
      const execution = vm.evalCode(source, SCRIPT_FILENAME, { type: "global" });
      timeout();
      if (execution.error) {
        const result = execution.error.consume(guestFailure);
        return fatal ? { ok: false, error: fatal.error, line: fatal.line ?? result.line, logs } : result;
      }
      const asynchronous = execution.value.consume((value): BuildFailure | undefined => {
        if (fatal) return { ok: false, ...fatal, logs };
        if (!runtime.hasPendingJob() && vm.typeof(value) !== "object") return;
        const state = vm.getPromiseState(value);
        if (state.type === "rejected") return state.error.consume(guestFailure);
        if (state.type === "fulfilled" && !state.notAPromise) state.value.dispose();
        if (runtime.hasPendingJob() || state.type === "pending") {
          return { ok: false, error: "The script queued asynchronous work. Build scripts must be synchronous and cannot import.", logs };
        }
      });
      if (asynchronous) return asynchronous;
    } finally {
      describe.dispose();
    }

    const checked = new Set<string>();
    for (const name of models.keys()) {
      try {
        validateModel(models, name, checked);
      } catch (error) {
        if (!(error instanceof BlockValidationError)) throw error;
        const { message, hint } = describeError(error);
        return { ok: false, error: sentence(message, hint), line: modelLines.get(name), logs };
      }
    }
  } finally {
    traceFunction.dispose();
    vm.dispose();
    runtime.dispose();
  }

  const messages = [...warnings.values()].slice(0, WARNING_LIMIT).map(({ line, victim, count }) =>
    `${line ? `${SCRIPT_FILENAME}:${line} ` : ""}overwrote ${count.toLocaleString("en-US")} block${count === 1 ? "" : "s"} owned by ${victim}`);
  if (warnings.size > WARNING_LIMIT) messages.push(`${warnings.size - WARNING_LIMIT} more overwrite warnings omitted`);
  return { ok: true, scene, logs, warnings: messages };
}

function describeThrown(vm: QuickJSContext, describe: QuickJSHandle, exception: QuickJSHandle): [string, string, string] {
  const detail = vm.callFunction(describe, vm.undefined, exception);
  if (detail.error) {
    detail.error.dispose();
    return ["The script threw an exception.", "", ""];
  }
  return detail.value.consume((value) =>
    [0, 1, 2].map((index) => vm.getProp(value, index).consume((part) => vm.getString(part))) as [string, string, string]);
}
