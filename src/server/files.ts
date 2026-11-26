import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { SceneData } from "../engine/scene";
import { exportBuild, exportFileName, type Format } from "./export";
import { ToolError } from "./store";
import { workspaceDirectory } from "./workspace-access";

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

export async function saveBuild(name: string, build: SceneData,
    { format, path, version }: { format: Format; path?: string; version: string }, subject?: string) {
  const { bytes, ...result } = await exportBuild(name, build, format, version);
  const base = await workspace(subject);
  const defaultName = exportFileName(name, format);
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
  return { path: filepath, downloadUrl: `/api/downloads/${id}`, format, version, ...result };
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
