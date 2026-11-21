import assert from "node:assert/strict";

const base = process.env.TSUMIKI_TEST_URL ?? "http://localhost:3000";
const token = process.env.TSUMIKI_MCP_TOKEN;
const name = `smoke-${Date.now()}`;
const headers = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
  "mcp-protocol-version": "2025-06-18",
  "x-tsumiki-workspace": name,
  ...(token ? { authorization: `Bearer ${token}` } : {}),
};

async function ready() {
  for (let i = 0; i < 40; i++) {
    try {
      if ((await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error("Tsumiki did not report healthy.");
}

let id = 0;
async function request(method, params) {
  const response = await fetch(`${base}/api/mcp`, {
    method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.text();
  assert(response.ok, `${response.status} ${body}`);
  const packet = JSON.parse(response.headers.get("content-type")?.includes("event-stream")
    ? body.split("\n").find(line => line.startsWith("data: ")).slice(6) : body);
  assert(!packet.error, JSON.stringify(packet.error));
  return packet.result;
}
async function tool(name, args, expected = true) {
  const packet = await request("tools/call", { name, arguments: args });
  const data = packet.structuredContent ?? JSON.parse(packet.content[0].text);
  assert.equal(data.ok, expected, JSON.stringify(data));
  assert.equal(typeof data.summary, "string");
  if (expected) assert(!packet.isError);
  return [data, packet.content.find(item => item.type === "image")];
}

async function viewer(undo = 0) {
  const response = await fetch(`${base}/api/structures/${name}?undo=${undo}`);
  assert(response.ok);
  return response.json();
}

await ready();
if (token) {
  const response = await fetch(`${base}/api/mcp`, { method: "POST" });
  assert.equal(response.status, 401);
}
const init = await request("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "tsumiki-smoke", version: "0.1.0" },
});
assert(init.serverInfo.name.toLowerCase().includes("tsumiki"));
const { tools } = await request("tools/list", {});
assert.deepEqual(tools.map(tool => tool.name).sort(), ["blocks", "build", "look", "open", "read", "save", "undo"]);
assert.equal((await tool("open", {}))[0].ok, true);
const [opened] = await tool("open", { name });
assert.equal(opened.blockCount, 0);
assert.equal(new URL(opened.viewerUrl).pathname, `/${name}`);
const [listed] = await tool("open", {});
assert.equal(listed.structures.find(structure => structure.name === name)?.viewerUrl, opened.viewerUrl);
const [catalog] = await tool("blocks", { q: "oak_stairs" });
assert(catalog.results.exact);

const events = await fetch(`${base}/api/structures/${name}/events`, { signal: AbortSignal.timeout(30_000) });
assert(events.ok);
const reader = events.body.getReader();
const decoder = new TextDecoder();
try {
  assert.match(decoder.decode((await reader.read()).value), /"version":0/);
  const [built, png] = await tool("build", { code: "fill([-1,0,-1,1,0,1], 'stone')\nset(0,1,0,'oak_stairs[facing=east]')" });
  assert.equal(built.placed, 10);
  assert.deepEqual(built.bounds, [-1, 0, -1, 1, 1, 1]);
  assert.equal(png.mimeType, "image/png");
  assert.equal(Buffer.from(png.data, "base64").subarray(1, 4).toString(), "PNG");
  assert.match(decoder.decode((await reader.read()).value), /"version":1/);
} finally {
  await reader.cancel();
}
const [failed] = await tool("build", { code: "set(0,1,0,'air')\nthrow new Error('rollback')" }, false);
assert.equal(failed.line, 2);
assert.equal((await viewer()).blockCount, 10);
assert.equal((await viewer(1)).blockCount, 0);
const [grid] = await tool("read", { y: 0, box: [1, 1, 1, -1, 0, -1] });
assert.match(grid.layers[0].grid, /###\n###\n###/);
const [counts] = await tool("read", { counts: true });
assert.equal(counts.counts[0].id, "stone");
assert.equal(counts.counts[0].count, 9);
const [, sheet] = await tool("look", { views: ["top", "north", "iso_sw", "iso_ne"], cut_y: 0 });
assert.equal(sheet.mimeType, "image/png");
const [saved] = await tool("save", {});
assert.match(saved.path, /\.schem$/);
const download = await fetch(new URL(new URL(saved.downloadUrl).pathname, base));
assert(download.ok);
assert.equal(new Uint8Array(await download.arrayBuffer())[0], 31);
const [functionFile] = await tool("save", { format: "mcfunction" });
const commands = await fetch(new URL(new URL(functionFile.downloadUrl).pathname, base)).then(r => r.text());
assert.match(commands, /^setblock .*minecraft:oak_stairs\[.*facing=east.*\] strict$/m);
const [imported] = await tool("open", { name: `${name}-import`, from: saved.path });
assert.equal(imported.blockCount, 10);
await tool("open", { name });
await Promise.all([
  tool("build", { code: "set(4,0,0,'stone')", look: false }),
  tool("build", { code: "set(5,0,0,'stone')", look: false }),
]);
assert.equal((await viewer()).blockCount, 12);
assert.equal((await viewer(2)).blockCount, 10);
await tool("undo", { steps: 3 });
assert.equal((await viewer()).blockCount, 0);
assert.equal((await fetch(`${base}/${name}`)).status, 200);
console.log("Verified all seven MCP tools, PNGs, SSE, history, concurrent builds, and export/import.");
