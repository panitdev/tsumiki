import { randomInt } from "node:crypto";
import { getQuickJS, type QuickJSContext, type QuickJSHandle } from "quickjs-emscripten";
import {
  BlockValidationError, UnknownBlockError, blockFamily, isAir, normalizeBlock, turnBlock,
  type TurnOptions,
} from "./catalog";
import {
  blockKey, coordinates, floatingGroups, getBounds, normalizeBox,
  type BlockChange, type Blocks, type Box, type FloatingGroup, type Position,
} from "./geometry";

const MAX_WRITES = 2_000_000;
const TIME_LIMIT = 10_000;
const MAX_COORDINATE = 30_000_000;
const MAX_CODE_LENGTH = 262_144;
const MAX_BLOCK_LENGTH = 4_096;
const WARNING_LIMIT = 20;
const MAX_LOGS = 100;
const SCRIPT_FILENAME = "build.js";

type BuildWarning =
  | { type: "unknown_block"; block: string; count: number; suggestions: string[]; message: string }
  | ({ type: "floating"; message: string } & FloatingGroup)
  | { type: "more_warnings"; message: string };

export interface BuildOptions {
  code: string;
  seed?: number;
}

export type BuildSuccess = {
  ok: true;
  summary: string;
  blocks: Blocks;
  changes: BlockChange[];
  placed: number;
  removed: number;
  bounds: Box | null;
  logs: string[];
  warnings: BuildWarning[];
  seed: number;
};

export type BuildFailure = {
  ok: false;
  summary: string;
  error: string;
  hint: string;
  line?: number;
};

export type BuildResult = BuildSuccess | BuildFailure;

function failure(error: string, hint: string, line?: number): BuildFailure {
  return {
    ok: false,
    summary: line ? `Build failed on line ${line}.` : "Build failed.",
    error,
    hint,
    ...(line ? { line } : {}),
  };
}

function seededRandom(seed: number): () => number {
  let state = (seed >>> 0) ^ (Math.floor(seed / 0x100000000) >>> 0);
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let result = Math.imul(state ^ (state >>> 15), state | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 0x100000000;
  };
}

interface MixChoice {
  block: string;
  weight: number;
  weightText?: string;
}

function splitMix(input: string): MixChoice[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  for (let i = 0; i < input.length; i++) {
    if (input[i] === "[") depth++;
    if (input[i] === "]") depth--;
    if (input[i] === "," && depth === 0) {
      parts.push(input.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(input.slice(start));
  return parts.map((part) => {
    const [block, weightText, ...extra] = part.trim().split("*").map((value) => value.trim());
    const weight = weightText === undefined ? 1 : Number(weightText);
    if (!block || extra.length || !Number.isFinite(weight) || weight <= 0 ||
      (weightText !== undefined && !/^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(weightText))) {
      throw new BlockValidationError("Invalid block mix.", 'Use positive weights as in "stone_bricks*6,mossy_stone_bricks*2".');
    }
    return { block, weight, weightText };
  });
}

interface Selection {
  block: string | UnknownBlockError;
  until: number;
}

function compileMix(input: string): Selection[] {
  let total = 0;
  return splitMix(input).map((choice) => {
    total += choice.weight;
    if (!Number.isFinite(total)) {
      throw new BlockValidationError("Block mix weights are too large.", "Use smaller weights in the same proportion.");
    }
    let block: string | UnknownBlockError;
    try {
      const normalized = normalizeBlock(choice.block);
      block = isAir(normalized) ? "air" : normalized;
    } catch (error) {
      if (!(error instanceof UnknownBlockError)) throw error;
      block = error;
    }
    return { block, until: total };
  });
}

function chooseBlock(selection: Selection[], random: () => number): string | UnknownBlockError {
  if (selection.length === 1) return selection[0].block;
  const target = random() * selection[selection.length - 1].until;
  return (selection.find(({ until }) => target < until) ?? selection[selection.length - 1]).block;
}

const bootstrap = `
  ((applyTurn, appendLog, rand) => {
    delete globalThis.__applyTurn;
    delete globalThis.__appendLog;
    const serialize = JSON.stringify;
    const text = String;
    const slice = Function.call.bind(String.prototype.slice);
    const replaceAll = Function.call.bind(String.prototype.replaceAll);
    const isArray = Array.isArray;
    const log = (...args) => {
      let line = "";
      for (let i = 0; i < args.length && line.length < 1024; i++) {
        let arg;
        try {
          arg = typeof args[i] === "string" ? args[i] : serialize(args[i]);
        } catch {
          arg = "[unserializable]";
        }
        if (i) line += " ";
        line += slice(arg ?? text(args[i]), 0, 1024 - line.length);
      }
      appendLog(slice(replaceAll(line, "\\0", "\\\\0"), 0, 1024));
    };
    const turn = (block, options = {}) => {
      if (!options || typeof options !== "object" || isArray(options)) {
        throw new TypeError('turn expects options such as {rotate: 90} or {mirror: "x"}.');
      }
      const { rotate, mirror } = options;
      if (mirror !== undefined && mirror !== "x" && mirror !== "z") {
        throw new TypeError('Set mirror to "x" or "z".');
      }
      return typeof block === "function"
        ? (x, y, z) => applyTurn(block(x, y, z), rotate, mirror)
        : applyTurn(block, rotate, mirror);
    };
    Object.assign(globalThis, { log, turn });
    Math.random = rand;
    return (error) => {
      const message = typeof error === "string" ? error : error?.message;
      const stack = error?.stack;
      const hint = error?.hint;
      return [
        typeof message === "string" ? slice(message, 0, 4096) : "The script threw an exception.",
        typeof stack === "string" ? slice(stack, 0, 4096) : "",
        typeof hint === "string" ? slice(hint, 0, 4096) : "",
      ];
    };
  })(__applyTurn, __appendLog, rand)
`;

function lineNumber(stack: string): number | undefined {
  const frame = /\bbuild\.js:(\d+)/.exec(stack);
  return frame ? Number(frame[1]) : undefined;
}

function guestFailure(vm: QuickJSContext, describe: QuickJSHandle, exception: QuickJSHandle): BuildFailure {
  const detail = vm.callFunction(describe, vm.undefined, exception);
  const defaultHint = "Fix the JavaScript on the indicated line and run the build again.";
  if (detail.error) {
    detail.error.dispose();
    return failure("The script threw an exception.", defaultHint);
  }
  return detail.value.consume((value) => {
    const error = vm.getProp(value, 0).consume((part) => vm.getString(part));
    const stack = vm.getProp(value, 1).consume((part) => vm.getString(part));
    const hint = vm.getProp(value, 2).consume((part) => vm.getString(part));
    return failure(error, hint || defaultHint, lineNumber(stack));
  });
}

interface UnknownPlacements {
  blocks: Map<string, { error: UnknownBlockError; count: number }>;
  omitted: number;
}

function buildWarnings(blocks: Blocks, bounds: Box | null, unknown: UnknownPlacements): BuildWarning[] {
  const warnings: BuildWarning[] = [...unknown.blocks].map(([block, { error, count }]) => ({
    type: "unknown_block",
    block,
    count,
    message: error.message,
    suggestions: error.suggestions,
  }));
  const floating = floatingGroups(blocks, bounds, WARNING_LIMIT);
  for (const group of floating.groups) {
    warnings.push({
      type: "floating",
      ...group,
      message: `${group.blockCount} floating block${group.blockCount === 1 ? "" : "s"} with no face connection to the lowest layer.`,
    });
  }
  if (unknown.omitted) {
    warnings.push({
      type: "more_warnings",
      message: `Skipped ${unknown.omitted} additional placements with unknown IDs.`,
    });
  }
  if (floating.count > floating.groups.length) {
    warnings.push({
      type: "more_warnings",
      message: `Found ${floating.count - floating.groups.length} additional floating groups.`,
    });
  }
  return warnings;
}

export async function runBuild(initial: ReadonlyMap<string, string>, options: BuildOptions): Promise<BuildResult> {
  const { code, seed = randomInt(0, 0x100000000) } = options;
  if (code.length > MAX_CODE_LENGTH) return failure("The script is too long.", "Split it into smaller builds.");
  if (!Number.isSafeInteger(seed)) return failure("Invalid seed.", "Use a safe integer seed.");

  const QuickJS = await getQuickJS();
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(64 * 1024 * 1024);
  runtime.setMaxStackSize(512 * 1024);

  const blocks = new Map(initial);
  const random = seededRandom(seed);
  const logs: string[] = [];
  const unknown: UnknownPlacements = { blocks: new Map(), omitted: 0 };
  const mixCache = new Map<string, Selection[]>();
  const deadline = performance.now() + TIME_LIMIT;
  let writes = 0;
  let fatal: BuildFailure | undefined;

  const timeout = () => {
    if (performance.now() < deadline) return false;
    fatal ??= failure("The build exceeded 10 seconds.", "Split the work into smaller builds or simplify the script.");
    return true;
  };
  runtime.setInterruptHandler(timeout);

  const vm = runtime.newContext();
  const selectionFor = (handle: QuickJSHandle | undefined): Selection[] => {
    const input = blockString(handle);
    let selection = mixCache.get(input);
    if (!selection) {
      selection = compileMix(input);
      if (mixCache.size < 2_048) mixCache.set(input, selection);
    }
    return selection;
  };
  function blockString(handle: QuickJSHandle | undefined): string {
    if (!handle || vm.typeof(handle) !== "string") {
      throw new BlockValidationError("Expected a block ID, mix, or block function.", "Return a block ID string from a block function.");
    }
    const length = vm.getProp(handle, "length").consume((value) => vm.getNumber(value));
    if (length > MAX_BLOCK_LENGTH) {
      throw new BlockValidationError("The block argument is too long.", "Use a shorter mix.");
    }
    const input = vm.getString(handle);
    if (input.length !== length) {
      throw new BlockValidationError("Invalid characters in a block argument.", "Use a block ID such as oak_stairs.");
    }
    return input;
  }
  function coordinate(handle: QuickJSHandle | undefined): number {
    const value = handle && vm.typeof(handle) === "number" ? vm.getNumber(handle) : NaN;
    if (!Number.isInteger(value) || Math.abs(value) > MAX_COORDINATE) {
      throw new BlockValidationError("Invalid block coordinate.", "Use integer coordinates between -30,000,000 and 30,000,000.");
    }
    return value;
  }
  function reserve(count: number) {
    writes += count;
    if (writes > MAX_WRITES) {
      fatal ??= failure("The build exceeded 2,000,000 block writes.", "Split the writes into smaller builds.");
      throw new BlockValidationError(fatal.error, fatal.hint);
    }
  }
  function put(x: number, y: number, z: number, input: string | UnknownBlockError): void {
    if (input instanceof UnknownBlockError) {
      const known = unknown.blocks.get(input.block);
      if (known) known.count++;
      else if (unknown.blocks.size < WARNING_LIMIT) unknown.blocks.set(input.block, { error: input, count: 1 });
      else unknown.omitted++;
      return;
    }
    const key = blockKey(x, y, z);
    if (input === "air") blocks.delete(key);
    else blocks.set(key, input);
  }
  function withBlock(fn: QuickJSHandle, [x, y, z]: Position) {
    const args = [vm.newNumber(x), vm.newNumber(y), vm.newNumber(z)];
    try {
      const value = vm.callFunction(fn, vm.undefined, args);
      if (value.error) return { error: value.error };
      value.value.consume((item) => put(x, y, z, chooseBlock(selectionFor(item), random)));
    } finally {
      for (const arg of args) arg.dispose();
    }
  }
  function register(name: string, callback: (...args: QuickJSHandle[]) =>
    QuickJSHandle | { error: QuickJSHandle } | void): void {
    vm.newFunction(name, (...args) => {
      try {
        if (timeout() || fatal) throw new BlockValidationError(fatal!.error, fatal!.hint);
        return callback(...args);
      } catch (error) {
        if (!(error instanceof BlockValidationError)) throw error;
        const exception = vm.newError(error.message);
        vm.newString(error.hint).consume((hint) => vm.setProp(exception, "hint", hint));
        if (fatal && fatal.line === undefined) {
          const line = vm.getProp(exception, "stack").consume((stack) => lineNumber(vm.getString(stack)));
          fatal = failure(fatal.error, fatal.hint, line);
        }
        return { error: exception };
      }
    }).consume((fn) => vm.setProp(vm.global, name, fn));
  }

  try {
    register("set", (x, y, z, block) => {
      const position: Position = [coordinate(x), coordinate(y), coordinate(z)];
      reserve(1);
      if (block && vm.typeof(block) === "function") return withBlock(block, position);
      put(...position, chooseBlock(selectionFor(block), random));
    });
    register("fill", (box, block) => {
      if (!box || vm.typeof(box) !== "object" || vm.getLength(box) !== 6) {
        throw new BlockValidationError("Invalid fill box.", "Use [x1, y1, z1, x2, y2, z2], with inclusive corners.");
      }
      const values = Array.from({ length: 6 }, (_, index) => vm.getProp(box, index).consume(coordinate));
      const [x1, y1, z1, x2, y2, z2] = normalizeBox(values as Box);
      reserve((x2 - x1 + 1) * (y2 - y1 + 1) * (z2 - z1 + 1));
      const callback = block && vm.typeof(block) === "function" ? block : undefined;
      const selection = callback ? undefined : selectionFor(block);
      const constant = selection?.length === 1 ? selection[0].block : undefined;
      let iterations = 0;
      for (let y = y1; y <= y2; y++) {
        for (let z = z1; z <= z2; z++) {
          for (let x = x1; x <= x2; x++) {
            if ((iterations++ & 1023) === 0 && timeout()) {
              throw new BlockValidationError(fatal!.error, fatal!.hint);
            }
            if (callback) {
              const error = withBlock(callback, [x, y, z]);
              if (error) return error;
            } else {
              put(x, y, z, constant ?? chooseBlock(selection!, random));
            }
          }
        }
      }
    });
    register("get", (x, y, z) => vm.newString(blocks.get(blockKey(coordinate(x), coordinate(y), coordinate(z))) ?? "air"));
    register("fam", (block) => {
      const family = blockFamily(blockString(block));
      const result = vm.newObject();
      for (const [name, id] of Object.entries(family)) {
        vm.newString(id).consume((value) => vm.setProp(result, name, value));
      }
      return result;
    });
    register("rand", () => vm.newNumber(random()));
    register("__appendLog", (value) => {
      if (logs.length < MAX_LOGS) logs.push(vm.getString(value).slice(0, 1_024));
      else if (logs.length === MAX_LOGS) logs.push("[Additional log lines omitted.]");
    });
    register("__applyTurn", (block, rotate, mirror) => {
      const options: TurnOptions = {};
      if (rotate && vm.typeof(rotate) !== "undefined") {
        options.rotate = vm.typeof(rotate) === "number" ? vm.getNumber(rotate) : NaN;
      }
      if (mirror && vm.typeof(mirror) !== "undefined") {
        const axis = vm.typeof(mirror) === "string" ? vm.getString(mirror) : "";
        if (axis !== "x" && axis !== "z") {
          throw new BlockValidationError("Invalid mirror axis.", 'Set mirror to "x" or "z".');
        }
        options.mirror = axis;
      }
      if (options.rotate !== undefined && (!Number.isSafeInteger(options.rotate) || options.rotate % 90 !== 0)) {
        throw new BlockValidationError("Invalid rotation.", "Set rotate to a multiple of 90 degrees clockwise.");
      }
      const transformed = splitMix(blockString(block)).map(({ block, weightText }) => {
        let id: string;
        try {
          id = turnBlock(block, options);
        } catch (error) {
          if (!(error instanceof UnknownBlockError)) throw error;
          id = block;
        }
        return weightText === undefined ? id : `${id}*${weightText}`;
      });
      return vm.newString(transformed.join(","));
    });

    const describe = vm.unwrapResult(vm.evalCode(bootstrap, "api.js", { type: "global" }));
    try {
      const execution = vm.evalCode(code, SCRIPT_FILENAME, { type: "global" });
      timeout();
      if (execution.error) {
        const result = execution.error.consume((exception) => guestFailure(vm, describe, exception));
        return fatal?.line ? fatal : fatal ? failure(fatal.error, fatal.hint, result.line) : result;
      }
      const result = execution.value.consume((value) => {
        if (fatal) return fatal;
        if (!runtime.hasPendingJob() && vm.typeof(value) !== "object") return;
        const state = vm.getPromiseState(value);
        if (state.type === "rejected") {
          return state.error.consume((exception) => guestFailure(vm, describe, exception));
        }
        if (state.type === "fulfilled" && !state.notAPromise) state.value.dispose();
        if (runtime.hasPendingJob() || state.type === "pending") {
          return failure("The script queued asynchronous work.", "Use synchronous JavaScript with the build functions. Imports are unavailable.");
        }
      });
      if (result) return result;
    } finally {
      describe.dispose();
    }
  } finally {
    vm.dispose();
    runtime.dispose();
  }

  const bounds = getBounds(blocks);
  const warnings = buildWarnings(blocks, bounds, unknown);
  const changes: BlockChange[] = [];
  let placed = 0;
  let removed = 0;
  for (const [key, after] of blocks) {
    const before = initial.get(key) ?? "air";
    if (before === after) continue;
    const [x, y, z] = coordinates(key);
    changes.push({ x, y, z, before, after });
    placed++;
  }
  for (const [key, before] of initial) {
    if (blocks.has(key)) continue;
    const [x, y, z] = coordinates(key);
    changes.push({ x, y, z, before, after: "air" });
    removed++;
  }
  return {
    ok: true,
    summary: `Placed ${placed} and removed ${removed} blocks${warnings.length ? ` with ${warnings.length} warning${warnings.length === 1 ? "" : "s"}` : ""}.`,
    blocks, changes, placed, removed, bounds, logs, warnings, seed,
  };
}
