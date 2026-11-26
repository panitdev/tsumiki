import { EventEmitter } from "node:events";
import { gzipSync, gunzipSync } from "node:zlib";
import { Pool, type PoolClient } from "pg";
import { blockCount, buildSource, emptyScene, encodeScene, sceneBounds, type Box, type SceneData } from "../engine";
import { runShell, type ProjectFiles, type ShellResult } from "./shell";

export const SOURCE_FILE = "build.js";

export type ProjectInfo = {
  name: string;
  /** Bounds and counts describe the last good build. */
  bounds: Box | null;
  blockCount: number;
  displayCount: number;
  /** The number of undo steps available. */
  revision: number;
  /** Increases whenever anything a viewer shows changes. */
  version: number;
  /** Why the current build.js does not build, or null. */
  buildError: string | null;
};

export class ToolError extends Error {
  constructor(message: string, readonly hint: string, readonly status = 400) {
    super(message);
  }
}

export function validateName(name: string): string {
  if (!name.trim() || name.trim() !== name || name.length > 80 || /[\/\\\u0000-\u001f\u007f]/u.test(name) ||
      [".", "..", "api", "_next", "favicon.ico"].includes(name.toLowerCase())) {
    throw new ToolError("Invalid project name.", "Use 1–80 characters without slashes, control characters or surrounding whitespace.");
  }
  return name;
}

const globals = globalThis as typeof globalThis & {
  tsumikiPool?: Pool;
  tsumikiSchema?: Promise<void>;
  tsumikiChanges?: EventEmitter;
};
export const changeEvents = globals.tsumikiChanges ??= new EventEmitter().setMaxListeners(0);

// The first statement removes the block-map storage of earlier releases, together with its
// structures. Never reuse those table names: this runs on every start.
const schema = `
  DROP TABLE IF EXISTS tsumiki_history, tsumiki_chunks, tsumiki_workspaces, tsumiki_structures;
  CREATE TABLE IF NOT EXISTS tsumiki_projects (
    name text PRIMARY KEY,
    files bytea NOT NULL,
    build bytea NOT NULL,
    build_error text,
    bounds integer[],
    block_count integer NOT NULL DEFAULT 0,
    display_count integer NOT NULL DEFAULT 0,
    revision integer NOT NULL DEFAULT 0,
    version integer NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS tsumiki_revisions (
    project text REFERENCES tsumiki_projects ON DELETE CASCADE,
    revision integer NOT NULL,
    source bytea,
    PRIMARY KEY (project, revision)
  );
  CREATE TABLE IF NOT EXISTS tsumiki_selections (
    id text PRIMARY KEY,
    project text NOT NULL REFERENCES tsumiki_projects ON DELETE CASCADE
  );
`;

async function database(): Promise<Pool> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const pool = globals.tsumikiPool ??= new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
  if (pool.listenerCount("error") === 0) pool.on("error", (error) => console.error("Idle Postgres connection", error.message));
  globals.tsumikiSchema ??= (async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(407165245)");
      await client.query(schema);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  })().catch((error) => {
    globals.tsumikiSchema = undefined;
    throw error;
  });
  await globals.tsumikiSchema;
  return pool;
}

async function transaction<T>(action: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await (await database()).connect();
  try {
    await client.query("BEGIN");
    const value = await action(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

const fields = `name, bounds, block_count AS "blockCount", display_count AS "displayCount", revision, version,
  build_error AS "buildError"`;

function encode(value: unknown): Buffer {
  return gzipSync(JSON.stringify(value), { level: 1 });
}

function decode<T>(buffer: Buffer): T {
  return JSON.parse(gunzipSync(buffer).toString("utf8")) as T;
}

function missing(name: string) {
  return new ToolError(`Project "${name}" does not exist.`, "Use open to create it or list available names.", 404);
}

interface Project {
  info: ProjectInfo;
  files: ProjectFiles;
  build: SceneData;
}

async function lockProject(client: PoolClient, name: string): Promise<Project> {
  const { rows } = await client.query<ProjectInfo & { files: Buffer; build: Buffer }>(
    `SELECT ${fields}, files, build FROM tsumiki_projects WHERE name=$1 FOR UPDATE`, [name]);
  if (!rows[0]) throw missing(name);
  const { files, build, ...info } = rows[0];
  return { info, files: decode<ProjectFiles>(files), build: decode<SceneData>(build) };
}

function sourceOf(files: ProjectFiles): string | null {
  return Object.hasOwn(files, SOURCE_FILE) ? files[SOURCE_FILE] : null;
}

/**
 * Builds the project's current source. A failed build keeps the last good one,
 * so only the files and the error change.
 */
async function rebuild(client: PoolClient, project: Project, files: ProjectFiles, revision: number) {
  const built = await buildSource(sourceOf(files), project.build);
  const { name } = project.info;
  if (built.data) {
    await client.query(`
      UPDATE tsumiki_projects SET files=$2, revision=$3, build=$4, build_error=NULL, bounds=$5,
        block_count=$6, display_count=$7, version=version+1 WHERE name=$1
    `, [name, encode(files), revision, encode(built.data), sceneBounds(built.data), blockCount(built.data),
      built.data.instances.reduce((sum, instance) => sum + instance.parts.length, 0)]);
  } else {
    await client.query(
      "UPDATE tsumiki_projects SET files=$2, revision=$3, build_error=$4, version=version+1 WHERE name=$1",
      [name, encode(files), revision, built.error]);
  }
  const { rows } = await client.query<ProjectInfo>(`SELECT ${fields} FROM tsumiki_projects WHERE name=$1`, [name]);
  return { info: rows[0], report: built.report };
}

/** Stores new files, and records a revision and builds when build.js changed. */
async function update(client: PoolClient, project: Project, files: ProjectFiles) {
  const source = sourceOf(files);
  if (source === sourceOf(project.files)) {
    await client.query("UPDATE tsumiki_projects SET files=$2 WHERE name=$1", [project.info.name, encode(files)]);
    return;
  }
  const revision = project.info.revision + 1;
  await client.query("INSERT INTO tsumiki_revisions (project,revision,source) VALUES ($1,$2,$3)",
    [project.info.name, revision, source === null ? null : encode(source)]);
  return rebuild(client, project, files, revision);
}

function announce(info: ProjectInfo | undefined) {
  if (info) changeEvents.emit(info.name, info.version);
}

export async function listProjects(): Promise<ProjectInfo[]> {
  const { rows } = await (await database()).query<ProjectInfo>(`SELECT ${fields} FROM tsumiki_projects ORDER BY name`);
  return rows;
}

export async function getProjectInfo(name: string): Promise<ProjectInfo> {
  const { rows } = await (await database()).query<ProjectInfo>(`SELECT ${fields} FROM tsumiki_projects WHERE name=$1`, [name]);
  if (!rows[0]) throw missing(name);
  return rows[0];
}

/** The last good build, read together with the information that describes it. */
export async function lastBuild(name: string): Promise<{ info: ProjectInfo; build: SceneData }> {
  const { rows } = await (await database()).query<ProjectInfo & { build: Buffer }>(
    `SELECT ${fields}, build FROM tsumiki_projects WHERE name=$1`, [name]);
  if (!rows[0]) throw missing(name);
  const { build, ...info } = rows[0];
  return { info, build: decode<SceneData>(build) };
}

/** Selects a project for the workspace, creating it if new. Reset empties build.js as one undoable step. */
export async function openProject(name: string, workspace: string, reset = false) {
  validateName(name);
  const result = await transaction(async (client) => {
    const files: ProjectFiles = { [SOURCE_FILE]: "" };
    const { rowCount } = await client.query(
      "INSERT INTO tsumiki_projects (name,files,build) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
      [name, encode(files), encode(encodeScene(emptyScene()))]);
    if (rowCount) {
      await client.query("INSERT INTO tsumiki_revisions (project,revision,source) VALUES ($1,0,$2)", [name, encode("")]);
    }
    const project = await lockProject(client, name);
    const changed = reset ? await update(client, project, files) : undefined;
    await client.query(`
      INSERT INTO tsumiki_selections (id, project) VALUES ($1,$2)
      ON CONFLICT (id) DO UPDATE SET project=excluded.project
    `, [workspace, name]);
    return { info: changed?.info ?? project.info, created: Boolean(rowCount), report: changed?.report, changed };
  });
  announce(result.changed?.info);
  return result;
}

export async function activeProject(workspace: string): Promise<string> {
  const { rows } = await (await database()).query<{ project: string }>(
    "SELECT project FROM tsumiki_selections WHERE id=$1", [workspace]);
  if (!rows[0]) throw new ToolError("No project is open.", "Call open with a project name first.");
  return rows[0].project;
}

/** Runs a shell command over the project and builds if build.js changed. Calls on a project run one at a time. */
export async function runCommand(name: string, command: string): Promise<ShellResult & { report?: string }> {
  const result = await transaction(async (client) => {
    const project = await lockProject(client, name);
    const shell = await runShell(project.files, command);
    const built = shell.files ? await update(client, project, shell.files) : undefined;
    return { ...shell, report: built?.report, info: built?.info };
  });
  announce(result.info);
  return result;
}

export async function undo(name: string, steps: number) {
  const result = await transaction(async (client) => {
    const project = await lockProject(client, name);
    const { revision } = project.info;
    if (steps > revision) {
      throw new ToolError(`Only ${revision} earlier revision${revision === 1 ? " is" : "s are"} available.`,
        "Choose a step count within the current history.");
    }
    const target = revision - steps;
    const { rows } = await client.query<{ source: Buffer | null }>(
      "SELECT source FROM tsumiki_revisions WHERE project=$1 AND revision=$2", [name, target]);
    const files = { ...project.files };
    if (rows[0].source) files[SOURCE_FILE] = decode<string>(rows[0].source);
    else delete files[SOURCE_FILE];
    await client.query("DELETE FROM tsumiki_revisions WHERE project=$1 AND revision>$2", [name, target]);
    return rebuild(client, project, files, target);
  });
  announce(result.info);
  return result;
}

export async function checkDatabase() {
  await (await database()).query("SELECT 1");
}
