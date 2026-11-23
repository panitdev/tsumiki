import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Blocks } from "../engine";
import { blockEntries, ToolError, type StructureInfo } from "./store";
import { readNbt, writeNbt } from "./formats/nbt";
import { materialList } from "./formats/materials";
import { targetCatalog } from "./formats/version";
import { workspaceDirectory } from "./workspace-access";

export const formats = ["schem", "litematic", "nbt", "mcfunction"] as const;
type Format = typeof formats[number];
const artifacts = ".tsumiki-downloads";
const users = ".tsumiki-users";

function inside(base: string, path: string) {
  const rel = relative(base, path);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

async function workspace(subject?: string) {
  const base = resolve(/* turbopackIgnore: true */ process.env.TSUMIKI_WORKSPACE ?? "workspace");
  await mkdir(base, { recursive: true });
  const root = await realpath(/* turbopackIgnore: true */ base);
  if (subject === undefined) return root;
  const parent = join(root, users);
  const directory = join(parent, workspaceDirectory(subject));
  for (const path of [parent, directory]) {
    await mkdir(path, { recursive: true, mode: 0o700 });
    if (await realpath(/* turbopackIgnore: true */ path) !== path) {
      throw new ToolError("The workspace directory is invalid.", "Check the configured Tsumiki workspace directories.");
    }
  }
  return directory;
}

function userPath(base: string, path: string) {
  const candidate = resolve(base, path);
  if (!inside(base, candidate) || inside(join(base, artifacts), candidate) || inside(join(base, users), candidate)) {
    throw new ToolError("The file path is outside the workspace.", "Use a path inside the configured Tsumiki workspace.");
  }
  return candidate;
}

export async function importStructure(path: string, subject?: string): Promise<Blocks> {
  const ext = extname(path).toLowerCase().slice(1);
  if (ext !== "schem" && ext !== "litematic" && ext !== "nbt") {
    throw new ToolError("Unsupported import format.", "Use a .schem, .litematic or .nbt file.");
  }
  try {
    const base = await workspace(subject);
    const target = userPath(base, await realpath(userPath(base, path)));
    const info = await stat(target);
    if (!info.isFile() || info.size > 64 * 1024 * 1024) {
      throw new ToolError("The import is not a file or exceeds 64 MiB.", "Choose a smaller structure file.");
    }
    return readNbt(ext, await readFile(target));
  } catch (error) {
    if (error instanceof ToolError) throw error;
    throw new ToolError("The structure file could not be read.", "Verify its path and confirm the file is a valid structure of the specified type.");
  }
}

export async function saveStructure(info: StructureInfo, blocks: ReadonlyMap<string, string>,
    { format, path, version }: { format: Format; path?: string; version: string }, subject?: string) {
  const target = await targetCatalog(version);
  const palette = ["minecraft:air"];
  const paletteIndices = new Map(palette.map((state, i) => [state, i]));
  const translated = new Map<string, number>();
  const substitutions = new Map<string, { from: string; to: string; count: number }>();
  const cells = [];
  for (const { x, y, z, state } of blockEntries(blocks)) {
    let index = translated.get(state);
    if (index === undefined) {
      const exported = target.translate(state);
      index = paletteIndices.get(exported);
      if (index === undefined) {
        index = palette.length;
        palette.push(exported);
        paletteIndices.set(exported, index);
      }
      translated.set(state, index);
      const id = exported.split("[", 1)[0].slice("minecraft:".length);
      if (id !== state.split("[", 1)[0]) substitutions.set(state, { from: state, to: exported, count: 0 });
    }
    const replacement = substitutions.get(state);
    if (replacement) replacement.count++;
    cells.push({ x, y, z, state: index });
  }
  const { materials, unplaceable } = materialList(palette, cells);
  const [ox, oy, oz] = info.bounds ?? [0, 0, 0];
  // Strict placement preserves explicit neighbor-dependent states from Java 1.21.5 onward.
  const strict = target.dataVersion >= 4325 ? " strict" : "";
  const bytes = format === "mcfunction" ? Buffer.from(
    cells.map(({ x, y, z, state }) => `setblock ~${x - ox} ~${y - oy} ~${z - oz} ${palette[state]}${strict}`).join("\n") + "\n",
  ) : writeNbt(format, info.name, target.dataVersion, info.bounds, palette, cells);
  const base = await workspace(subject);
  const defaultName = info.name.replace(/[<>:"|?*]/g, "_") + `.${format}`;
  let filepath = userPath(base, path ?? defaultName);
  if (path) {
    try {
      if ((await stat(/* turbopackIgnore: true */ filepath)).isDirectory()) filepath = join(/* turbopackIgnore: true */ filepath, defaultName);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (extname(filepath).toLowerCase() !== `.${format}`) {
      throw new ToolError(`The destination must end in .${format}.`, "Choose a file with the matching extension or an existing directory.");
    }
  }
  try {
    filepath = userPath(base, join(await realpath(dirname(filepath)), basename(filepath)));
  } catch (error) {
    if (error instanceof ToolError) throw error;
    throw new ToolError("The destination directory could not be opened.", "Create the directory in the workspace or omit path.");
  }
  const id = randomUUID();
  const directory = join(base, artifacts, id);
  await mkdir(directory, { recursive: true });
  const temp = join(dirname(filepath), `.${id}.tmp`);
  try {
    await writeFile(join(directory, basename(filepath)), bytes, { flag: "wx" });
    await writeFile(temp, bytes, { flag: "wx" });
    await rename(temp, filepath);
  } catch (error) {
    await Promise.allSettled([rm(directory, { recursive: true, force: true }), rm(temp, { force: true })]);
    console.error("Tsumiki export error", error);
    throw new ToolError("The export could not be saved.", "Check the workspace permissions and file path.");
  }
  return { path: filepath, downloadUrl: `/api/downloads/${id}`, format, version, materials, unplaceable, substitutions: [...substitutions.values()] };
}

export async function download(id: string, subject?: string) {
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(id)) return;
  const directory = join(await workspace(subject), artifacts, id);
  try {
    const [name] = await readdir(directory);
    if (name) return { name, bytes: await readFile(join(directory, name)) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
