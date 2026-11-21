import { AsyncLocalStorage } from "node:async_hooks";
import { timingSafeEqual, createHash } from "node:crypto";
import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { runBuild, searchBlocks } from "../engine";
import { renderContactSheet } from "../render/contact-sheet";
import { importStructure, saveStructure, formats } from "./files";
import { materials, readLayers } from "./read";
import {
  activeStructure, blockEntries, buildStructure, listStructures, openStructure, snapshot,
  ToolError, undoStructure,
} from "./store";

const views = z.enum(["iso_ne", "iso_nw", "iso_se", "iso_sw", "top", "north", "south", "east", "west"]);
const coordinate = z.number().int().min(-30_000_000).max(30_000_000);
const box = z.tuple([coordinate, coordinate, coordinate, coordinate, coordinate, coordinate])
  .transform(([a, b, c, x, y, z]) => [
    Math.min(a, x), Math.min(b, y), Math.min(c, z), Math.max(a, x), Math.max(b, y), Math.max(c, z),
  ] as [number, number, number, number, number, number]);

type Result = { ok: boolean; summary?: string; [key: string]: unknown };
type ImageResult = { result: Result; png: Buffer };

const requests = new AsyncLocalStorage<{ workspace: string; origin: string }>();
function context() {
  const request = requests.getStore();
  if (!request) throw new Error("Request context is unavailable.");
  return request;
}

function resultMessage(value: Result | ImageResult) {
  const result = ("png" in value ? value.result : value) as Result;
  const png = "png" in value ? value.png as Buffer : undefined;
  const response = { ...result, summary: (result.summary ?? String(result.error ?? "Request failed.")).split(/\r?\n/, 1)[0] };
  const content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[] = [
    { type: "text", text: JSON.stringify(response) },
  ];
  if (png) content.push({ type: "image", data: png.toString("base64"), mimeType: "image/png" });
  return { content, structuredContent: response, isError: !result.ok };
}

function tool<T>(action: (input: T) => Promise<Result | ImageResult> | Result | ImageResult) {
  return async (input: T) => {
    try {
      return resultMessage(await action(input));
    } catch (error) {
      if (error instanceof ToolError) {
        return resultMessage({ ok: false, error: error.message, hint: error.hint });
      }
      console.error("Tsumiki tool error", error);
      return resultMessage({
        ok: false, error: "Tsumiki could not complete the request.",
        hint: "Check the server logs and deployment configuration.",
      });
    }
  };
}

async function render(...args: Parameters<typeof renderContactSheet>) {
  try {
    return await renderContactSheet(...args);
  } catch (error) {
    console.error("Tsumiki render error", error);
    throw new ToolError("The PNG render could not be created.", "Check the Minecraft client jar and WebGL display setup, narrow the view box, or use build with look:false.");
  }
}

const handler = createMcpHandler((server) => {
  server.registerTool("open", {
    description: "Omit name to list existing structure names and viewer links. Supply a name to select or create a structure for this workspace, or import a workspace .schem, .litematic or .nbt.",
    inputSchema: z.object({ name: z.string().max(80).optional(), from: z.string().min(1).optional() }),
  }, tool(async ({ name, from }) => {
    const { workspace, origin } = context();
    const viewerUrl = (structure: string) => new URL(`/${encodeURIComponent(structure)}`, origin).href;
    if (name === undefined) {
      if (from) throw new ToolError("An import needs a name.", "Supply a new structure name.");
      const structures = await listStructures();
      return {
        ok: true, summary: `${structures.length} structures.`,
        structures: structures.map((info) => ({ ...info, viewerUrl: viewerUrl(info.name) })),
      };
    }
    const { info, blocks } = await openStructure(name, workspace, from ? () => importStructure(from) : undefined);
    return {
      ok: true, summary: `Opened "${name}" with ${info.blockCount} blocks.`, ...info,
      materials: materials(blocks).slice(0, 10), viewerUrl: viewerUrl(name),
    };
  }));

  server.registerTool("build", {
    description: [
      "Run synchronous JavaScript against the open structure as one undo step.",
      "Use set(x,y,z,block), fill([x1,y1,z1,x2,y2,z2],block), get(x,y,z),",
      "turn(block,{rotate:90,mirror:'x'}), fam(id), rand(), and log(...values).",
      "Fill corners are inclusive. A block can be 'oak_stairs[facing=north]',",
      "'stone_bricks*6,mossy_stone_bricks*2', or (x,y,z)=>id. Air erases.",
      "Positive rotations are clockwise. Set seed to repeat rand() and mixes.",
      "Each call can run for 10 seconds and write up to 2 million blocks.",
    ].join(" "),
    inputSchema: z.object({ code: z.string().min(1).max(262_144), look: z.union([views, z.literal(false)]).default("iso_se"), seed: z.number().int().optional() }),
  }, tool(async ({ code, look, seed }) => {
    const name = await activeStructure(context().workspace);
    return buildStructure<Result | ImageResult>(name, async (blocks) => {
      const outcome = await runBuild(blocks, { code, seed });
      if (!outcome.ok) return { result: outcome };
      const { blocks: updated, changes, ...result } = outcome;
      const image = look === false ? undefined : await render(blockEntries(updated), { views: [look] });
      return { result: image ? { result, png: image } : result, updated: { blocks: updated, changes } };
    });
  }));

  server.registerTool("look", {
    description: "Render one PNG contact sheet of up to four views. Supply box or cut_y to reveal part of the structure.",
    inputSchema: z.object({ views: z.array(views).min(1).max(4).default(["iso_se"]), box: box.optional(), cut_y: coordinate.optional() }),
    annotations: { readOnlyHint: true },
  }, tool(async ({ views, box, cut_y }) => {
    const { info, blocks } = await snapshot(await activeStructure(context().workspace));
    return {
      result: { ok: true, summary: `Rendered ${views.length} view${views.length === 1 ? "" : "s"} of "${info.name}".`, views, bounds: box ?? info.bounds },
      png: await render(blockEntries(blocks), { views, box, cutY: cut_y }),
    };
  }));

  server.registerTool("read", {
    description: "Read block states as text grids (X columns, Z rows), or count materials. Optionally limit box and Y range.",
    inputSchema: z.object({ y: z.union([coordinate, z.tuple([coordinate, coordinate])]).optional(), box: box.optional(), counts: z.boolean().default(false) }),
    annotations: { readOnlyHint: true },
  }, tool(async ({ y, box, counts }) => {
    const { info, blocks } = await snapshot(await activeStructure(context().workspace));
    let bounds = box ?? info.bounds;
    if (y !== undefined && counts && bounds) {
      const [min, max] = typeof y === "number" ? [y, y] : y;
      if (min > max) throw new ToolError("The Y range is reversed.", "Use [lowest Y, highest Y].");
      bounds = [bounds[0], Math.max(bounds[1], min), bounds[2], bounds[3], Math.min(bounds[4], max), bounds[5]];
    }
    if (counts) {
      const counts = materials(blocks, bounds ?? undefined);
      return { ok: true, summary: `Counted ${counts.length} materials in "${info.name}".`, bounds, counts };
    }
    const layers = readLayers(blocks, bounds, y);
    return { ok: true, summary: `Read ${layers.length} layers of "${info.name}".`, bounds, layers };
  }));

  server.registerTool("blocks", {
    description: "Search up to 20 block IDs by name or color. An exact ID returns properties and family forms.",
    inputSchema: z.object({ q: z.string().min(1).max(120) }),
    annotations: { readOnlyHint: true },
  }, tool(async ({ q }) => ({ ok: true, summary: `Block catalog results for "${q}".`, results: searchBlocks(q) })));

  server.registerTool("undo", {
    description: "Undo one or more build calls in the active structure.",
    inputSchema: z.object({ steps: z.number().int().positive().max(2_147_483_647).default(1) }),
    annotations: { destructiveHint: true },
  }, tool(async ({ steps }) => {
    const info = await undoStructure(await activeStructure(context().workspace), steps);
    return { ok: true, summary: `Undid ${steps} build step${steps === 1 ? "" : "s"} in "${info.name}".`, ...info };
  }));

  server.registerTool("save", {
    description: "Export the active structure to the workspace and get a download URL and material list. Paths must be within the workspace.",
    inputSchema: z.object({ format: z.enum(formats).default("schem"), path: z.string().min(1).optional(), version: z.string().default("26.3") }),
  }, tool(async ({ format, path, version }) => {
    const { info, blocks } = await snapshot(await activeStructure(context().workspace));
    const save = await saveStructure(info, blocks, { format, path, version });
    return {
      ok: true, summary: `Saved "${info.name}" as ${format} for Minecraft ${version}.`, ...save,
      downloadUrl: new URL(save.downloadUrl, context().origin).href,
    };
  }));
}, {
  serverInfo: { name: "Tsumiki", version: "0.1.0" },
  instructions: "Call open with no arguments to discover existing structure names and viewer links. Call open with the exact name before building, inspecting, or saving it. A new name creates a structure. Share its viewerUrl with the user. Coordinates are x east, y up, z south. Use build with look:false to skip the default iso_se PNG.",
  maxSubscriptions: 0,
});

function hash(value: string) {
  return createHash("sha256").update(value).digest();
}

export async function handleMcp(request: Request) {
  const auth = request.headers.get("Authorization");
  const token = process.env.TSUMIKI_MCP_TOKEN;
  if (token && (!auth || !timingSafeEqual(hash(auth), hash(`Bearer ${token}`)))) {
    return Response.json({ error: "Tsumiki MCP authorization required." }, {
      status: 401, headers: { "WWW-Authenticate": "Bearer" },
    });
  }
  const workspace = request.headers.get("X-Tsumiki-Workspace") ?? "default";
  if (!/^[a-zA-Z0-9._-]{1,80}$/.test(workspace)) {
    return Response.json({ error: "Invalid X-Tsumiki-Workspace header." }, { status: 400 });
  }
  // Local unauthenticated mode is for direct MCP clients. A foreign browser
  // origin must not be able to drive that local endpoint.
  const origin = process.env.TSUMIKI_BASE_URL ?? new URL(request.url).origin;
  const source = request.headers.get("Origin");
  if (source && source !== new URL(origin).origin) {
    return Response.json({ error: "Cross-origin MCP requests are not allowed." }, { status: 403 });
  }
  if (request.method === "POST" && !request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
    return Response.json({ error: "Expected application/json." }, { status: 415 });
  }
  return requests.run({ workspace, origin }, () => handler(request));
}
