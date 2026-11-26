import { AsyncLocalStorage } from "node:async_hooks";
import { timingSafeEqual, createHash } from "node:crypto";
import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { normalizeBox, type Box, type Position } from "../engine/geometry";
import { SelectorError } from "../engine/selector";
import { renderImage } from "../render/image";
import { formats } from "./export";
import { saveBuild } from "./files";
import { BASH_DESCRIPTION, INSTRUCTIONS } from "./mcp-guide";
import { authorizeMcpOAuth, mcpOAuthConfig, mcpOAuthConfigurationError, mcpWriteScope } from "./mcp-oauth";
import { workspaceSelection } from "./workspace-access";
import { activeProject, lastBuild, listProjects, openProject, runCommand, undo, ToolError } from "./store";

const coordinate = z.number().int().min(-30_000_000).max(30_000_000);
const cell = z.array(coordinate).length(3);
const point = z.array(z.number().min(-30_000_000).max(30_000_000)).length(3);

type Result = { ok: boolean; summary?: string; [key: string]: unknown };
/** Plain output, as from a shell, with an optional image. */
type TextResult = { text: string; png?: Buffer };

const requests = new AsyncLocalStorage<{ workspace: string; origin: string; subject?: string; canWrite: boolean }>();
function context() {
  const request = requests.getStore();
  if (!request) throw new Error("Request context is unavailable.");
  return request;
}

function resultMessage(value: Result | TextResult) {
  type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
  if ("text" in value) {
    const { text, png } = value as TextResult;
    const content: Content[] = [{ type: "text", text }];
    if (png) content.push({ type: "image", data: png.toString("base64"), mimeType: "image/png" });
    return { content, isError: false };
  }
  const response = { ...value, summary: (value.summary ?? String(value.error ?? "Request failed.")).split(/\r?\n/, 1)[0] };
  const content: Content[] = [{ type: "text", text: JSON.stringify(response) }];
  return { content, structuredContent: response, isError: !value.ok };
}

function tool<T>(
  action: (input: T) => Promise<Result | TextResult>,
  writes?: true | ((input: T) => boolean),
) {
  return async (input: T) => {
    try {
      if ((writes === true || writes?.(input)) && !context().canWrite) {
        throw new ToolError("This tool call requires mcp:write.", "Authorize the MCP client with the mcp:write scope.");
      }
      return resultMessage(await action(input));
    } catch (error) {
      if (error instanceof ToolError || error instanceof SelectorError) {
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

const handler = createMcpHandler((server) => {
  const viewerUrl = (project: string) => new URL(`/${encodeURIComponent(project)}`, context().origin).href;

  server.registerTool("open", {
    description: "Omit name to list projects and their viewer links. Supply a name to switch to a project, creating it if new. reset: true also empties its build.js, which undo can reverse.",
    inputSchema: z.object({ name: z.string().max(80).optional(), reset: z.boolean().optional() }),
  }, tool(async ({ name, reset }) => {
    if (name === undefined) {
      if (reset) throw new ToolError("Reset needs a project name.", "Supply the name of the project to reset.");
      const projects = await listProjects();
      return {
        ok: true, summary: `${projects.length} project${projects.length === 1 ? "" : "s"}.`,
        projects: projects.map((info) => ({ ...info, viewerUrl: viewerUrl(info.name) })),
      };
    }
    const { info, created, report } = await openProject(name, context().workspace, reset);
    return {
      ok: true, summary: `${created ? "Created" : reset ? "Reset" : "Opened"} "${name}" with ${info.blockCount} blocks.`,
      ...info, ...(report ? { report } : {}), viewerUrl: viewerUrl(name),
    };
  }, ({ name }) => name !== undefined));

  server.registerTool("bash", {
    description: BASH_DESCRIPTION,
    inputSchema: z.object({ command: z.string().min(1).max(512 * 1024) }),
  }, tool(async ({ command }) => {
    const { stdout, stderr, exitCode, notes, report } = await runCommand(await activeProject(context().workspace), command);
    const sections = [
      stdout, stderr, exitCode ? `[exit code ${exitCode}]` : "", ...notes.map((note) => `[note] ${note}`), report ?? "",
    ].filter(Boolean).map((section) => section.replace(/\n$/, ""));
    return { text: sections.join("\n") || "(no output)" };
  }, true));

  server.registerTool("render", {
    description: [
      "Draw the last good build as one PNG seen from camera.from looking toward camera.at, in world coordinates",
      "(cell 0 spans 0 to 1; x east, y up, z south). Looking straight down puts north at the top.",
      "hide takes a build script selector and leaves out its groups and instances.",
      "section [[x1,y1,z1],[x2,y2,z2]] shows only the cells in that inclusive box, to cut a building open;",
      "a block display stays when its centre is inside. Call again for another viewpoint.",
    ].join(" "),
    inputSchema: z.object({
      camera: z.object({ from: point, at: point }),
      hide: z.string().min(1).max(1_024).optional(),
      section: z.array(cell).length(2).optional(),
    }),
    annotations: { readOnlyHint: true },
  }, tool(async ({ camera, hide, section }) => {
    const [from, at] = [camera.from as Position, camera.at as Position];
    if (from.every((value, axis) => value === at[axis])) {
      throw new ToolError("The camera is at its own target.", "Move camera.from away from camera.at.");
    }
    const { info, build } = await lastBuild(await activeProject(context().workspace));
    const box = section && normalizeBox([...section[0], ...section[1]] as Box);
    let image;
    try {
      image = await renderImage(build, { camera: { from, at }, hide, section: box });
    } catch (error) {
      if (error instanceof SelectorError) throw error;
      console.error("Tsumiki render error", error);
      throw new ToolError("The PNG render could not be created.", "Check the Minecraft client jar and WebGL display setup, or narrow the section.");
    }
    const lines = [`"${info.name}": ${image.blocks} blocks and ${image.displays} block displays shown.`];
    if (info.buildError) lines.push(`This is the last good build. The current build.js fails: ${info.buildError}`);
    return { text: lines.join("\n"), png: image.png };
  }));

  server.registerTool("undo", {
    description: "Restore build.js to how it was before the last changing bash call (or several, with steps), then rebuild.",
    inputSchema: z.object({ steps: z.number().int().positive().max(2_147_483_647).default(1) }),
    annotations: { destructiveHint: true },
  }, tool(async ({ steps }) => {
    const { report } = await undo(await activeProject(context().workspace), steps);
    return { text: `Undid ${steps} change${steps === 1 ? "" : "s"} to build.js.\n${report}` };
  }, true));

  server.registerTool("save", {
    description: "Export the last good build to the workspace and get a download URL and material list. Block displays are exported as one block_display entity per block part (Java 1.19.4 or later). Paths must be within the workspace.",
    inputSchema: z.object({ format: z.enum(formats).default("schem"), path: z.string().min(1).optional(), version: z.string().default("26.3") }),
  }, tool(async ({ format, path, version }) => {
    const { info, build } = await lastBuild(await activeProject(context().workspace));
    const saved = await saveBuild(info.name, build, { format, path, version }, context().subject);
    return {
      ok: true, summary: `Saved "${info.name}" as ${format} for Minecraft ${version}.`, ...saved,
      ...(info.buildError ? { staleBecause: info.buildError } : {}),
      downloadUrl: new URL(saved.downloadUrl, context().origin).href,
    };
  }, true));
}, {
  serverInfo: { name: "Tsumiki", version: "0.1.0" },
  instructions: INSTRUCTIONS,
  maxSubscriptions: 0,
});

function hash(value: string) {
  return createHash("sha256").update(value).digest();
}

export async function handleMcp(request: Request) {
  let oauth: ReturnType<typeof mcpOAuthConfig>;
  try {
    oauth = mcpOAuthConfig();
  } catch {
    return mcpOAuthConfigurationError();
  }
  let subject: string | undefined;
  let canWrite = true;
  if (oauth) {
    const authorization = await authorizeMcpOAuth(request, oauth);
    if (authorization instanceof Response) return authorization;
    subject = authorization.subject;
    canWrite = authorization.scopes.has(mcpWriteScope);
  } else {
    const auth = request.headers.get("Authorization");
    const token = process.env.TSUMIKI_MCP_TOKEN;
    if (token && (!auth || !timingSafeEqual(hash(auth), hash(`Bearer ${token}`)))) {
      return Response.json({ error: "Tsumiki MCP authorization required." }, {
        status: 401, headers: { "WWW-Authenticate": "Bearer" },
      });
    }
  }
  const workspace = request.headers.get("X-Tsumiki-Workspace") ?? "default";
  if (!/^[a-zA-Z0-9._-]{1,80}$/.test(workspace)) {
    return Response.json({ error: "Invalid X-Tsumiki-Workspace header." }, { status: 400 });
  }
  // Local unauthenticated mode is for direct MCP clients. A foreign browser
  // origin must not be able to drive that local endpoint.
  const origin = oauth?.resource.origin ?? process.env.TSUMIKI_BASE_URL ?? new URL(request.url).origin;
  const source = request.headers.get("Origin");
  if (source && source !== new URL(origin).origin) {
    return Response.json({ error: "Cross-origin MCP requests are not allowed." }, { status: 403 });
  }
  if (request.method === "POST" && !request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
    return Response.json({ error: "Expected application/json." }, { status: 415 });
  }
  return requests.run({ workspace: workspaceSelection(workspace, subject), origin, subject, canWrite }, () => handler(request));
}
