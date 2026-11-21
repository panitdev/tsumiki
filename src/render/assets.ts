import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { unzipSync } from "fflate";
import { PNG } from "pngjs";
import type { BlockFlags, BlockModelElement, UV } from "deepslate/render";
import { getBlockDefaults } from "../engine/catalog";
import type { RenderAssetData } from "./shared";

interface ModelJson {
  parent?: string;
  elements?: BlockModelElement[];
  textures?: Record<string, string | { sprite: string }>;
}

type Variant = { model: string };
type Variants = Variant | Variant[];
interface BlockstateJson {
  variants?: Record<string, Variants>;
  multipart?: { apply: Variants }[];
}

interface Sprite {
  id: string;
  image: PNG;
  x: number;
  y: number;
  width: number;
  height: number;
  transparent: boolean;
}

interface Assets {
  data: RenderAssetData;
  json: string;
  atlas: PNG;
  atlasPng: Buffer;
  etag: string;
}

const RESOURCE = /^assets\/([^/]+)\/(blockstates|models\/block)\/(.+)\.json$/;
const TEXTURE = /^assets\/([^/]+)\/textures\/((?:block|entity\/(?:banner|bed|bell|chest|conduit|copper_golem|creeper|decorated_pot|enderdragon|piglin|player|shulker|signs|skeleton|zombie))\/.+)\.png$/;
const DIRECTIONS = ["down", "up", "north", "south", "east", "west"] as const;

const cache = globalThis as typeof globalThis & {
  tsumikiClientAssets?: { path: string; loading: Promise<Assets> };
};

export function getAssets(): Promise<Assets> {
  const clientJar = process.env.MINECRAFT_CLIENT_JAR;
  if (!clientJar) throw new Error("Set MINECRAFT_CLIENT_JAR to the path of a Minecraft Java Edition client jar.");
  if (cache.tsumikiClientAssets?.path !== clientJar) {
    const loading = loadAssets(clientJar);
    cache.tsumikiClientAssets = { path: clientJar, loading };
    void loading.catch(() => {
      if (cache.tsumikiClientAssets?.loading === loading) cache.tsumikiClientAssets = undefined;
    });
  }
  return cache.tsumikiClientAssets.loading;
}

async function loadAssets(clientJar: string): Promise<Assets> {
  const jar = await readFile(clientJar).catch((cause: unknown) => {
    throw new Error("Could not read the client jar configured by MINECRAFT_CLIENT_JAR.", { cause });
  });
  const entries = unzipSync(jar, {
    filter: ({ name }) => name === "version.json" || RESOURCE.test(name) || TEXTURE.test(name)
      || name.endsWith(".png.mcmeta") && TEXTURE.test(name.slice(0, -7)),
  });

  const blockstates: Record<string, BlockstateJson> = Object.create(null);
  const models: Record<string, ModelJson> = Object.create(null);
  const sprites: Sprite[] = [];
  for (const [name, bytes] of Object.entries(entries)) {
    const resource = RESOURCE.exec(name);
    if (resource) {
      const [, namespace, kind, path] = resource;
      if (kind === "blockstates") blockstates[`${namespace}:${path}`] = parseJson(bytes);
      else models[`${namespace}:block/${path}`] = parseJson(bytes);
      continue;
    }
    const texture = TEXTURE.exec(name);
    if (texture) sprites.push(readSprite(`${texture[1]}:${texture[2]}`, bytes, entries[`${name}.mcmeta`]));
  }
  if (!Object.keys(blockstates).length || !Object.keys(models).length || !sprites.length) {
    throw new Error("The file configured by MINECRAFT_CLIENT_JAR does not contain Minecraft client rendering assets.");
  }

  const { atlas, textures } = makeAtlas(sprites);
  const defaults: RenderAssetData["defaults"] = Object.create(null);
  for (const id of Object.keys(blockstates)) {
    const properties = getBlockDefaults(id);
    if (properties && Object.keys(properties).length > 0) defaults[id] = properties;
  }
  const flags = classifyBlocks(blockstates, models, sprites);
  const manifest = entries["version.json"] ? parseJson<{ id?: string }>(entries["version.json"]) : {};
  const data: RenderAssetData = { version: manifest.id ?? "unknown", blockstates, models, textures, flags, defaults };
  const json = JSON.stringify(data);
  const atlasPng = PNG.sync.write(atlas);
  const etag = `"${createHash("sha256").update(json).update(atlasPng).digest("hex")}"`;
  return { data, atlas, atlasPng, etag, json };
}

function parseJson<T>(bytes: Uint8Array): T {
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

function readSprite(id: string, bytes: Uint8Array, metadata?: Uint8Array): Sprite {
  const image = PNG.sync.read(Buffer.from(bytes));
  const animation = metadata ? parseJson<{ animation?: {
    width?: number;
    height?: number;
    frames?: (number | { index: number })[];
  } }>(metadata).animation : undefined;
  const shortestSide = Math.min(image.width, image.height);
  const width = animation ? animation.width ?? (animation.height === undefined ? shortestSide : image.width) : image.width;
  const height = animation ? animation.height ?? (animation.width === undefined ? shortestSide : image.height) : image.height;
  const first = animation?.frames?.[0];
  const frame = typeof first === "number" ? first : first?.index ?? 0;
  const columns = Math.floor(image.width / width);
  const x = (frame % columns) * width;
  const y = Math.floor(frame / columns) * height;
  let transparent = false;
  for (let row = y; row < y + height && !transparent; row++) {
    for (let col = x; col < x + width; col++) {
      if (image.data[(row * image.width + col) * 4 + 3] < 255) {
        transparent = true;
        break;
      }
    }
  }
  return { id, image, x, y, width, height, transparent };
}

function makeAtlas(sprites: Sprite[]): { atlas: PNG; textures: Record<string, UV> } {
  const missing = new PNG({ width: 16, height: 16 });
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const offset = (y * 16 + x) * 4;
      missing.data.writeUInt32BE((x < 8) === (y < 8) ? 0xff00ffff : 0x000000ff, offset);
    }
  }
  sprites.sort((a, b) => b.height - a.height || b.width - a.width || a.id.localeCompare(b.id));
  const spriteArea = sprites.reduce((sum, sprite) => sum + sprite.width * sprite.height, 256);
  const minSide = Math.max(Math.ceil(Math.sqrt(spriteArea)), ...sprites.map(sprite => Math.max(sprite.width, sprite.height)));
  for (let side = 2 ** Math.ceil(Math.log2(minSide)); side <= 8192; side *= 2) {
    const locations: [number, number][] = [];
    let x = 0;
    let y = 16;
    let shelfHeight = 0;
    for (const sprite of sprites) {
      if (x + sprite.width > side) {
        x = 0;
        y += shelfHeight;
        shelfHeight = 0;
      }
      if (y + sprite.height > side) break;
      locations.push([x, y]);
      x += sprite.width;
      shelfHeight = Math.max(shelfHeight, sprite.height);
    }
    if (locations.length !== sprites.length) continue;

    const atlas = new PNG({ width: side, height: side, fill: true });
    const textures: Record<string, UV> = Object.create(null);
    PNG.bitblt(missing, atlas, 0, 0, 16, 16, 0, 0);
    sprites.forEach((sprite, index) => {
      const [u, v] = locations[index];
      PNG.bitblt(sprite.image, atlas, sprite.x, sprite.y, sprite.width, sprite.height, u, v);
      textures[sprite.id] = [u / side, v / side, (u + sprite.width) / side, (v + sprite.height) / side];
    });
    return { atlas, textures };
  }
  throw new Error("The client jar textures exceed the supported atlas size.");
}

function classifyBlocks(blockstates: Record<string, BlockstateJson>, models: Record<string, ModelJson>, sprites: Sprite[]) {
  const flags: RenderAssetData["flags"] = Object.create(null);
  const opaqueSprites = new Set(sprites.filter(sprite => !sprite.transparent).map(sprite => sprite.id));
  const opaqueModels = new Map<string, boolean>();
  for (const [id, definition] of Object.entries(blockstates)) {
    const variants = Object.values(definition.variants ?? {}).flat();
    const isGlass = /:(?:glass(?:_pane)?|tinted_glass|.+_stained_glass(?:_pane)?)$/.test(id);
    const result: BlockFlags = {};
    if (isGlass || /:(?:water|ice|frosted_ice|slime_block|honey_block|nether_portal)$/.test(id)) {
      result.semi_transparent = true;
    }
    if (isGlass || /:(?:water|ice)$/.test(id)) result.self_culling = true;
    if (!isGlass && variants.length > 0 && variants.every(variant => {
      const id = qualify(variant.model);
      let opaque = opaqueModels.get(id);
      if (opaque === undefined) {
        opaque = isOpaqueCube(id, models, opaqueSprites);
        opaqueModels.set(id, opaque);
      }
      return opaque;
    })) result.opaque = true;
    if (Object.keys(result).length > 0) flags[id] = result;
  }
  return flags;
}

function qualify(id: string) {
  return id.includes(":") ? id : `minecraft:${id}`;
}

function isOpaqueCube(id: string, models: Record<string, ModelJson>, opaqueSprites: Set<string>) {
  const visited = new Set<string>();
  const textures: NonNullable<ModelJson["textures"]> = Object.create(null);
  let elements: ModelJson["elements"];
  let model: ModelJson | undefined = models[id];
  while (model && !visited.has(id)) {
    visited.add(id);
    elements ??= model.elements;
    for (const [name, value] of Object.entries(model.textures ?? {})) textures[name] ??= value;
    id = model.parent ? qualify(model.parent) : "";
    model = models[id];
  }
  return elements?.some(element => !element.rotation
    && element.from.every(value => value === 0) && element.to.every(value => value === 16)
    && DIRECTIONS.every(direction => {
      const face = element.faces?.[direction];
      if (!face) return false;
      const seen = new Set<string>();
      let texture = face.texture;
      if (!texture.startsWith("#") && textures[texture]) texture = `#${texture}`;
      while (texture.startsWith("#")) {
        if (seen.has(texture)) return false;
        seen.add(texture);
        const value = textures[texture.slice(1)];
        if (!value) return false;
        texture = typeof value === "string" ? value : value.sprite;
      }
      return opaqueSprites.has(qualify(texture));
    })) ?? false;
}

export async function serveAsset(request: Request, kind: "manifest" | "atlas"): Promise<Response> {
  try {
    const assets = await getAssets();
    const headers = { "Cache-Control": "private, no-cache", ETag: assets.etag };
    const cached = request.headers.get("If-None-Match")?.split(",").some(tag => {
      const value = tag.trim().replace(/^W\//, "");
      return value === "*" || value === assets.etag;
    });
    if (cached) return new Response(null, { status: 304, headers });
    const isAtlas = kind === "atlas";
    return new Response(isAtlas ? new Uint8Array(assets.atlasPng) : assets.json, {
      headers: { ...headers, "Content-Type": isAtlas ? "image/png" : "application/json" },
    });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Minecraft assets could not be loaded." }, { status: 503 });
  }
}
