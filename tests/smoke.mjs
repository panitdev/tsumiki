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

/** A tool that answers with JSON. */
async function tool(toolName, args, expected = true) {
  const packet = await request("tools/call", { name: toolName, arguments: args });
  const data = packet.structuredContent ?? JSON.parse(packet.content[0].text);
  assert.equal(data.ok, expected, JSON.stringify(data));
  assert.equal(typeof data.summary === "string" || !expected, true);
  return data;
}

/** A tool that answers with plain text and perhaps an image. */
async function output(toolName, args) {
  const packet = await request("tools/call", { name: toolName, arguments: args });
  assert(!packet.isError, JSON.stringify(packet));
  return [packet.content[0].text, packet.content.find(item => item.type === "image")];
}

const bash = async command => (await output("bash", { command }))[0];

async function viewer() {
  const response = await fetch(`${base}/api/structures/${name}`);
  assert(response.ok);
  return response.json();
}

const camera = { from: [18, 14, 18], at: [3, 2, -6] };
async function render(args = {}) {
  const [text, image] = await output("render", { camera, ...args });
  assert.equal(image.mimeType, "image/png");
  const png = Buffer.from(image.data, "base64");
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  return [text, png];
}

const script = `
model("streetlight", [
  { block: "dark_oak_fence", at: [0.5, 0.5, 0.5], scale: [1, 4, 1] },
  { at: [0.5, 4, 0.5], rotate: [0, 0, -20], children: [
      { block: "dark_oak_slab", at: [0.9, 0, 0], scale: [1.6, 0.2, 0.3] },
      { block: "lantern",       at: [1.6, -0.8, 0] },
  ]},
], { tags: ["light"] })

function house([x, y, z]) {
  group("Walls", () => fill([x, y, z], [x + 6, y + 4, z + 6], "oak_planks"))
  group("Interior", () => fill([x + 1, y + 1, z + 1], [x + 5, y + 4, z + 5], "air"))
  group("Door", () => fill([x + 3, y + 1, z], [x + 3, y + 2, z], "air"))
}

group("Village", () => {
  group("House A", () => house([0, 0, 0]))
  group("House B", () => house([10, 0, 0]))
})

group("Street", () => {
  for (let i = 0; i < 5; i++) use("streetlight", { at: [3, 1, -6 * i], rotate: [0, 90, 0] })
})
`;

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
assert.deepEqual(tools.map(tool => tool.name).sort(), ["bash", "open", "render", "save", "undo"]);
await tool("open", {});
const opened = await tool("open", { name });
assert.equal(opened.blockCount, 0);
assert.equal(opened.revision, 0);
assert.equal(new URL(opened.viewerUrl).pathname, `/${name}`);
const listed = await tool("open", {});
assert.equal(listed.structures, undefined);
assert.equal(listed.projects.find(project => project.name === name)?.viewerUrl, opened.viewerUrl);
await render();

const events = await fetch(`${base}/api/structures/${name}/events`, { signal: AbortSignal.timeout(60_000) });
assert(events.ok);
const reader = events.body.getReader();
const decoder = new TextDecoder();
try {
  assert.match(decoder.decode((await reader.read()).value), /"version":0/);
  const built = await bash(`cat > /project/build.js <<'END'\n${script}END`);
  assert.match(built, /^\[build ok · \d+ ms\] \+\d+ −0 blocks · \+15 −0 block displays · Street, .* rebuilt$/m);
  assert.match(decoder.decode((await reader.read()).value), /"version":1/);
} finally {
  await reader.cancel();
}

// Reading changes nothing.
assert.equal(await bash("grep -c oak_planks build.js"), "1");
assert.equal((await viewer()).revision, 1);
const good = await viewer();
assert.equal(good.displayCount, 15);
assert.equal(good.build.instances.length, 5);

const [, whole] = await render();
const [, noStreet] = await render({ hide: "@streetlight" });
assert(!whole.equals(noStreet), "hiding the streetlights changes the picture");
const [, cut] = await render({ section: [[-5, -5, -40], [30, 2, 10]] });
assert(!whole.equals(cut), "a section changes the picture");
const [, fromAbove] = await render({ camera: { from: [5, 40, -8], at: [5, 0, -8] } });
assert(!whole.equals(fromAbove));
const unmatched = await tool("render", { camera, hide: "Stret" }, false);
assert.match(unmatched.hint, /Did you mean Street\?/);

// A failed build keeps the edit but the viewer, render and export keep the last good build.
const failed = await bash(`sed -i 's/"oak_planks"/"oak_planks_stairs"/' build.js`);
assert.match(failed, /^\[build failed\] build\.js:\d+ unknown block "oak_planks_stairs", did you mean "oak_stairs"\?$/m);
const afterFailure = await viewer();
assert.deepEqual(afterFailure.build, good.build);
assert.match(afterFailure.buildError, /unknown block/);
assert.equal(afterFailure.revision, 2);
const [staleText, stale] = await render();
assert.match(staleText, /last good build/);
assert(stale.equals(whole));
assert.match(await bash("grep -c oak_planks_stairs build.js"), /^1$/);

const [undone] = await output("undo", {});
assert.match(undone, /\[build ok/);
assert.equal((await viewer()).buildError, null);
assert.equal((await viewer()).revision, 1);
assert.equal(await bash("grep -c oak_planks_stairs build.js || true"), "0");

const logged = await bash(`echo 'log(select("Village > \\"House A\\"")[0])' >> build.js`);
assert.match(logged, /^log: \{ kind: "group", path: "Village\/House A", bounds: \[\[0,0,0\],\[6,4,6\]\] \}$/m);
assert.match(logged, /no changes/);
assert.match(await bash("false"), /\[exit code 1\]/);
assert.match(await bash("python3 -c 'print(1)'"), /command not found/);

// Calls on one project run one at a time, so neither edit is lost.
await Promise.all([
  bash(`echo 'set(40,0,0,"stone")' >> build.js`),
  bash(`echo 'set(41,0,0,"stone")' >> build.js`),
]);
assert.equal((await viewer()).blockCount, good.blockCount + 2);

const saved = await tool("save", {});
assert.match(saved.path, /\.schem$/);
const download = await fetch(new URL(new URL(saved.downloadUrl).pathname, base));
assert(download.ok);
assert.equal(new Uint8Array(await download.arrayBuffer())[0], 31);
for (const format of ["schem", "litematic", "nbt", "mcfunction"]) {
  const response = await fetch(`${base}/api/structures/${name}/export?format=${format}`);
  assert(response.ok, `${format} ${response.status}`);
  assert(response.headers.get("content-disposition").includes(`.${format}`));
  const bytes = Buffer.from(await response.arrayBuffer());
  if (format === "mcfunction") {
    assert.match(bytes.toString(), /^setblock ~40 ~0 ~0 minecraft:stone strict$/m);
    assert.equal(bytes.toString().match(/summon minecraft:block_display/g).length, 15);
  } else assert.equal(bytes[0], 31);
}
assert.equal((await fetch(`${base}/api/structures/${name}/export?format=zip`)).status, 400);

const reset = await tool("open", { name, reset: true });
assert.equal(reset.blockCount, 0);
await output("undo", {});
assert.equal((await viewer()).blockCount, good.blockCount + 2);
const tooFar = await tool("undo", { steps: 1000 }, false);
assert.match(tooFar.error, /earlier revision/);
assert.equal((await fetch(`${base}/${name}`)).status, 200);
console.log("Verified the five MCP tools, builds, renders, failure handling, undo, concurrent edits, exports and SSE.");
