/**
 * Guest-side half of the script API. It runs before build.js, wraps the host
 * functions, and removes everything that could make two runs differ.
 * Returns a function that describes a thrown value for the host.
 */
export const bootstrap = `
(() => {
  const host = {};
  for (const name of ["__log", "__enter", "__exit", "__model", "__use", "__select", "__bounds", "__remove"]) {
    host[name] = globalThis[name];
    delete globalThis[name];
  }
  const stringify = JSON.stringify;
  const parse = JSON.parse;
  const text = String;
  const isArray = Array.isArray;
  const keys = Object.keys;
  const define = Object.defineProperty;
  const slice = Function.call.bind(String.prototype.slice);
  const join = Function.call.bind(Array.prototype.join);
  const selections = new WeakSet();
  const isSelection = Function.call.bind(WeakSet.prototype.has, selections);
  const markSelection = Function.call.bind(WeakSet.prototype.add, selections);
  const MAX_LINE = 2048;
  const MAX_LINES = 101;

  const format = (value, depth) => {
    if (typeof value === "string") return depth ? stringify(value) : value;
    if (typeof value === "function") return "[function]";
    if (value === null || typeof value !== "object") return text(value);
    if (depth > 5) return "…";
    const parts = [];
    let length = 0;
    const push = (part) => {
      parts[parts.length] = part;
      length += part.length;
    };
    if (isArray(value)) {
      for (let i = 0; i < value.length && length < MAX_LINE; i++) push(format(value[i], depth + 1));
      return "[" + join(parts, ",") + "]";
    }
    const names = keys(value);
    for (let i = 0; i < names.length && length < MAX_LINE; i++) {
      push(names[i] + ": " + format(value[names[i]], depth + 1));
    }
    return parts.length ? "{ " + join(parts, ", ") + " }" : "{}";
  };
  const append = (line) => host.__log(slice(line, 0, MAX_LINE));

  const log = (...args) => {
    // A lone selection prints one match per line.
    if (args.length === 1 && isSelection(args[0]) && args[0].length) {
      for (let i = 0; i < args[0].length && i < MAX_LINES; i++) append(format(args[0][i], 1));
      return;
    }
    let line = "";
    for (let i = 0; i < args.length && line.length < MAX_LINE; i++) {
      line += (i ? " " : "") + format(args[i], 0);
    }
    append(line);
  };

  const group = (name, fn) => {
    if (typeof fn !== "function") throw new TypeError('group takes a name and a function: group("Walls", () => { ... })');
    host.__enter(name);
    try {
      const result = fn();
      if (result && typeof result.then === "function") throw new TypeError("group functions cannot be async.");
      return result;
    } finally {
      host.__exit();
    }
  };

  const serialize = (value) => value === undefined ? "null" : stringify(value, (key, item) => {
    // JSON would silently turn these into null or drop them.
    if (typeof item === "number" && !isFinite(item)) throw new TypeError("Model and instance numbers must be finite.");
    if (typeof item === "function") throw new TypeError("Model and instance data cannot contain functions.");
    return item;
  });
  const model = (name, parts, options) => host.__model(name, serialize(parts), serialize(options));
  const use = (name, options) => host.__use(name, serialize(options));

  const select = (selector) => {
    const { handle, matches } = parse(host.__select(selector));
    for (let i = 0; i < matches.length; i++) {
      define(matches[i], "bounds", { enumerable: true, get: () => parse(host.__bounds(handle, i)) });
    }
    define(matches, "remove", { value: () => host.__remove(handle) });
    markSelection(matches);
    return matches;
  };

  Object.assign(globalThis, { log, group, model, use, select });
  const unavailable = (what, instead) => () => { throw new TypeError(what + " is not available. " + instead); };
  Math.random = unavailable("Math.random", "Use rand().");
  delete globalThis.Promise;

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
})()
`;
