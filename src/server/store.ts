import { EventEmitter } from "node:events";
import { gzipSync, gunzipSync } from "node:zlib";
import { Pool, type PoolClient } from "pg";
import { blockKey, coordinates, getBounds, type BlockChange, type Blocks, type Box } from "../engine";

export type StructureInfo = {
  name: string;
  bounds: Box | null;
  blockCount: number;
  historyDepth: number;
  version: number;
};

export class ToolError extends Error {
  constructor(message: string, readonly hint: string, readonly status = 400) {
    super(message);
  }
}

export function validateName(name: string): string {
  if (!name.trim() || name.trim() !== name || name.length > 80 || /[\/\\\u0000-\u001f\u007f]/u.test(name) ||
      [".", "..", "api", "_next", "favicon.ico"].includes(name.toLowerCase())) {
    throw new ToolError("Invalid structure name.", "Use 1–80 characters without slashes, control characters or surrounding whitespace.");
  }
  return name;
}

const globals = globalThis as typeof globalThis & {
  tsumikiPool?: Pool;
  tsumikiSchema?: Promise<void>;
  tsumikiChanges?: EventEmitter;
};
export const changeEvents = globals.tsumikiChanges ??= new EventEmitter().setMaxListeners(0);

const schema = `
  CREATE TABLE IF NOT EXISTS tsumiki_structures (
    name text PRIMARY KEY,
    bounds integer[],
    block_count integer NOT NULL DEFAULT 0,
    history_depth integer NOT NULL DEFAULT 0,
    version integer NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS tsumiki_chunks (
    name text REFERENCES tsumiki_structures ON DELETE CASCADE,
    x integer NOT NULL, y integer NOT NULL, z integer NOT NULL,
    blocks bytea NOT NULL,
    PRIMARY KEY (name, x, y, z)
  );
  CREATE TABLE IF NOT EXISTS tsumiki_history (
    name text REFERENCES tsumiki_structures ON DELETE CASCADE,
    step integer NOT NULL,
    changes bytea NOT NULL,
    PRIMARY KEY (name, step)
  );
  CREATE TABLE IF NOT EXISTS tsumiki_workspaces (
    id text PRIMARY KEY,
    active text NOT NULL REFERENCES tsumiki_structures ON DELETE CASCADE
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

async function transaction<T>(write: boolean, action: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await (await database()).connect();
  try {
    await client.query(write ? "BEGIN" : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
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

const fields = 'name, bounds, block_count AS "blockCount", history_depth AS "historyDepth", version';

function missing(name: string) {
  return new ToolError(`Structure "${name}" does not exist.`, "Use open to create it or list available names.", 404);
}

async function structure(client: PoolClient, name: string, lock = false): Promise<StructureInfo> {
  const result = await client.query<StructureInfo>(`SELECT ${fields} FROM tsumiki_structures WHERE name = $1${lock ? " FOR UPDATE" : ""}`, [name]);
  if (!result.rows[0]) throw missing(name);
  return result.rows[0];
}

type ChunkEntry = [index: number, state: string];
type Chunk = { x: number; y: number; z: number; blocks: Buffer };

function encode(value: unknown): Buffer {
  return gzipSync(JSON.stringify(value), { level: 1 });
}

function decode<T>(buffer: Buffer): T {
  return JSON.parse(gunzipSync(buffer).toString("utf8")) as T;
}

function packChunks(blocks: ReadonlyMap<string, string>): Chunk[] {
  const chunks = new Map<string, ChunkEntry[]>();
  for (const [key, state] of blocks) {
    const [x, y, z] = coordinates(key);
    const chunk = blockKey(Math.floor(x / 16), Math.floor(y / 16), Math.floor(z / 16));
    const entry: ChunkEntry = [(x & 15) | ((y & 15) << 4) | ((z & 15) << 8), state];
    const entries = chunks.get(chunk);
    if (entries) entries.push(entry);
    else chunks.set(chunk, [entry]);
  }
  return Array.from(chunks, ([key, entries]) => {
    const [x, y, z] = coordinates(key);
    return { x, y, z, blocks: encode(entries) };
  });
}

async function loadBlocks(client: PoolClient, name: string): Promise<Blocks> {
  const { rows } = await client.query<Chunk>("SELECT x,y,z,blocks FROM tsumiki_chunks WHERE name=$1", [name]);
  const blocks: Blocks = new Map();
  for (const { x, y, z, blocks: compressed } of rows) {
    for (const [slot, state] of decode<ChunkEntry[]>(compressed)) {
      blocks.set(blockKey(x * 16 + (slot & 15), y * 16 + ((slot >> 4) & 15), z * 16 + (slot >> 8)), state);
    }
  }
  return blocks;
}

async function persist(client: PoolClient, info: StructureInfo, blocks: ReadonlyMap<string, string>): Promise<StructureInfo> {
  const chunks = packChunks(blocks);
  await client.query("DELETE FROM tsumiki_chunks WHERE name=$1", [info.name]);
  if (chunks.length) {
    await client.query(`
      INSERT INTO tsumiki_chunks (name,x,y,z,blocks)
      SELECT $1,* FROM unnest($2::integer[], $3::integer[], $4::integer[], $5::bytea[])
    `, [info.name, chunks.map(c => c.x), chunks.map(c => c.y), chunks.map(c => c.z), chunks.map(c => c.blocks)]);
  }
  const { rows } = await client.query<StructureInfo>(`
    UPDATE tsumiki_structures SET bounds=$2, block_count=$3, history_depth=$4, version=version+1
    WHERE name=$1 RETURNING ${fields}
  `, [info.name, getBounds(blocks), blocks.size, info.historyDepth]);
  return rows[0];
}

async function rewind(client: PoolClient, info: StructureInfo, blocks: Blocks, steps: number) {
  if (steps > info.historyDepth) {
    throw new ToolError(`Only ${info.historyDepth} build steps are available.`, "Choose a step count within the current history.");
  }
  if (steps === 0) return;
  const { rows } = await client.query<{ changes: Buffer }>(`
    SELECT changes FROM tsumiki_history WHERE name=$1 AND step>$2 ORDER BY step DESC
  `, [info.name, info.historyDepth - steps]);
  for (const row of rows) {
    for (const { x, y, z, before } of decode<BlockChange[]>(row.changes)) {
      const key = blockKey(x, y, z);
      if (before === "air") blocks.delete(key);
      else blocks.set(key, before);
    }
  }
}

export async function listStructures(): Promise<StructureInfo[]> {
  const { rows } = await (await database()).query<StructureInfo>(`SELECT ${fields} FROM tsumiki_structures ORDER BY name`);
  return rows;
}

export async function getStructureInfo(name: string): Promise<StructureInfo> {
  const { rows } = await (await database()).query<StructureInfo>(`SELECT ${fields} FROM tsumiki_structures WHERE name=$1`, [name]);
  if (!rows[0]) throw missing(name);
  return rows[0];
}

export async function openStructure(name: string, workspace: string, from?: () => Promise<Blocks>) {
  validateName(name);
  return transaction(true, async (client) => {
    const { rowCount } = await client.query("INSERT INTO tsumiki_structures (name) VALUES ($1) ON CONFLICT DO NOTHING", [name]);
    let info = await structure(client, name, true);
    if (!rowCount && from) throw new ToolError(`Structure "${name}" already exists.`, "Import into a new name or omit from to open the existing structure.", 409);
    const blocks = from ? await from() : await loadBlocks(client, name);
    if (from) info = await persist(client, info, blocks);
    await client.query(`
      INSERT INTO tsumiki_workspaces (id, active) VALUES ($1,$2)
      ON CONFLICT (id) DO UPDATE SET active=excluded.active
    `, [workspace, name]);
    return { info, blocks };
  });
}

export async function activeStructure(workspace: string): Promise<string> {
  const { rows } = await (await database()).query<{ active: string }>("SELECT active FROM tsumiki_workspaces WHERE id=$1", [workspace]);
  if (!rows[0]) throw new ToolError("No structure is open.", "Call open with a structure name first.");
  return rows[0].active;
}

export async function snapshot(name: string, undo = 0) {
  return transaction(false, async (client) => {
    const info = await structure(client, name);
    const blocks = await loadBlocks(client, name);
    await rewind(client, info, blocks, undo);
    if (undo) {
      info.bounds = getBounds(blocks);
      info.blockCount = blocks.size;
    }
    return { info, blocks };
  });
}

export async function buildStructure<T>(name: string, build: (blocks: Blocks) => Promise<{
  result: T;
  updated?: { blocks: Blocks; changes: BlockChange[] };
}>): Promise<T> {
  const { result, info } = await transaction(true, async (client) => {
    const info = await structure(client, name, true);
    const { result, updated } = await build(await loadBlocks(client, name));
    if (!updated) return { result };
    info.historyDepth++;
    await client.query("INSERT INTO tsumiki_history (name,step,changes) VALUES ($1,$2,$3)", [name, info.historyDepth, encode(updated.changes)]);
    return { result, info: await persist(client, info, updated.blocks) };
  });
  if (info) changeEvents.emit(name, info.version);
  return result;
}

export async function undoStructure(name: string, steps: number): Promise<StructureInfo> {
  const info = await transaction(true, async (client) => {
    const info = await structure(client, name, true);
    const blocks = await loadBlocks(client, name);
    await rewind(client, info, blocks, steps);
    info.historyDepth -= steps;
    await client.query("DELETE FROM tsumiki_history WHERE name=$1 AND step>$2", [name, info.historyDepth]);
    return persist(client, info, blocks);
  });
  changeEvents.emit(name, info.version);
  return info;
}

export async function checkDatabase() {
  await (await database()).query("SELECT 1");
}

export function* blockEntries(blocks: ReadonlyMap<string, string>) {
  for (const [key, state] of blocks) {
    const [x, y, z] = coordinates(key);
    yield { x, y, z, state };
  }
}
