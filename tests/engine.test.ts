import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSource, decodeScene, diffScenes, emptyScene, encodeScene, runBuild, sceneBlocks, select, turnBlock,
  type BuildSuccess, type SceneData,
} from "../src/engine";

const example = `
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

async function build(source: string): Promise<BuildSuccess> {
  const result = await runBuild(source);
  assert(result.ok, result.ok ? "" : `${result.line}: ${result.error}`);
  return result;
}

async function logs(source: string) {
  return (await build(source)).logs;
}

async function data(source: string): Promise<SceneData> {
  return encodeScene((await build(source)).scene);
}

function blocks(scene: SceneData) {
  return new Map(Array.from(sceneBlocks(scene), ({ x, y, z, state }) => [`${x},${y},${z}`, state]));
}

async function failure(source: string) {
  const { report, data } = await buildSource(source, null);
  assert.equal(data, undefined);
  return report;
}

test("the same source always builds byte-identical output", async () => {
  const source = `${example}\ngroup("Noise", () => { for (let i = 0; i < 50; i++) set(Math.floor(rand() * 30), 20, i, "stone") })`;
  assert.equal(JSON.stringify(await data(source)), JSON.stringify(await data(source)));
});

test("the example builds houses and five streetlight displays", async () => {
  const scene = await data(example);
  assert.equal(scene.instances.length, 5);
  assert.deepEqual(scene.instances.map(({ id }) => id).slice(0, 2), ["Street/streetlight-1", "Street/streetlight-2"]);
  assert.equal(scene.instances[0].parts.length, 3);
  assert.deepEqual(scene.instances[0].tags, ["light"]);
  assert.equal(blocks(scene).get("0,0,0"), "oak_planks");
  assert.equal(blocks(scene).has("3,1,0"), false);
});

test("rand and generated ids depend only on their own group", async () => {
  const lamp = 'model("lamp", [{ block: "lantern", at: [0, 0, 0] }])\n';
  const b = 'group("B", () => { log(rand(), rand()); log(use("lamp", { at: [0, 0, 0] })) })';
  const before = await logs(`${lamp}${b}`);
  const after = await logs(`${lamp}group("A", () => { rand(); use("lamp", { at: [1, 1, 1] }) })\nrand()\n${b}`);
  assert.deepEqual(after, before);
  assert.equal(before[1], "B/lamp-1");
  const merged = await logs('group("A", () => log(rand()))\ngroup("A", () => log(rand()))');
  assert.deepEqual(merged, await logs('group("A", () => { log(rand()); log(rand()) })'));
  assert.notEqual(merged[0], merged[1]);
});

test("a block belongs to the last group that placed it, and air removes it", async () => {
  const wall = 'group("Walls", () => fill([0,0,0], [2,2,0], "stone"))\ngroup("Door", () => set(1,0,0, "oak_door"))\n';
  const withoutWalls = blocks(await data(`${wall}select("Walls").remove()`));
  assert.deepEqual([...withoutWalls], [["1,0,0", "oak_door"]]);
  const withoutDoor = blocks(await data(`${wall}select("Door").remove()`));
  assert.equal(withoutDoor.size, 8);
  assert.equal(withoutDoor.has("1,0,0"), false);
  assert.deepEqual(await logs('set(0,0,0,"stone")\nset(0,0,0,"air")\nlog(get(0,0,0))'), ["air"]);
});

test("large fills and overlapping edits keep exact cells", async () => {
  const scene = await data(`
    fill([-20,-20,-20], [20,20,20], "stone")
    fill([-16,0,-16], [15,15,15], "air")
    fill([-1,-1,-1], [17,17,17], "dirt")
  `);
  const expected = new Map<string, string>();
  const paint = (a: number[], b: number[], state: string) => {
    for (let x = a[0]; x <= b[0]; x++) for (let y = a[1]; y <= b[1]; y++) for (let z = a[2]; z <= b[2]; z++) {
      if (state === "air") expected.delete(`${x},${y},${z}`);
      else expected.set(`${x},${y},${z}`, state);
    }
  };
  paint([-20, -20, -20], [20, 20, 20], "stone");
  paint([-16, 0, -16], [15, 15, 15], "air");
  paint([-1, -1, -1], [17, 17, 17], "dirt");
  const actual = blocks(scene);
  assert.equal(actual.size, expected.size);
  for (const [key, state] of expected) assert.equal(actual.get(key), state, key);
  assert.deepEqual(diffScenes(decodeScene(scene), decodeScene(JSON.parse(JSON.stringify(scene)))),
    { added: 0, removed: 0, displaysAdded: 0, displaysRemoved: 0, rebuilt: [] });
});

test("selectors match groups, models, tags and ids", async () => {
  const { scene } = await build(`
    model("lamp", [{ block: "lantern", at: [0, 0, 0] }], { tags: ["light"] })
    group("Market Street", () => {
      use("lamp", { at: [0, 0, 0], tags: ["broken"] })
      group("Stall", () => use("lamp", { at: [2, 0, 0], id: "light-3" }))
    })
    use("lamp", { at: [4, 0, 0] })
  `);
  const ids = (selector: string) => {
    const found = select(scene, selector);
    return [...found.groups.map((id) => scene.groups[id]!.name), ...found.instances.map((i) => scene.instances[i]!.id)];
  };
  assert.deepEqual(ids("Stall"), ["Stall"]);
  assert.deepEqual(ids('"Market Street"'), ["Market Street"]);
  assert.deepEqual(ids('"Market Street" .light'), ["Market Street/lamp-1", "light-3"]);
  assert.deepEqual(ids('"Market Street" > @lamp'), ["Market Street/lamp-1"]);
  assert.deepEqual(ids('"Market Street" > Stall'), ["Stall"]);
  assert.deepEqual(ids("@lamp.broken"), ["Market Street/lamp-1"]);
  assert.deepEqual(ids('#"Market Street/lamp-1"'), ["Market Street/lamp-1"]);
  assert.deepEqual(ids("#light-3"), ["light-3"]);
  assert.deepEqual(ids("#lamp-1"), ["lamp-1"]);
  assert.deepEqual(ids("@lamp .light"), []);
  assert.throws(() => select(scene, "a, b"), /Invalid selector/);
});

test("an unquoted generated id with a slash selects its instance", async () => {
  const source = `${example}\nselect("#Street/streetlight-3").remove()`;
  assert.deepEqual((await data(source)).instances.map(({ id }) => id).includes("Street/streetlight-3"), false);
});

test("select reports bounds, sees the world so far and can remove groups", async () => {
  assert.deepEqual(await logs(`
    group("Castle", () => group("Keep", () => fill([0,0,0], [8,12,8], "stone")))
    log(select("Keep"))
    select("Castle").remove()
    log(select("Keep"))
    group("Castle", () => set(1,1,1,"stone"))
    log(select("Castle")[0].bounds)
  `), ['{ kind: "group", path: "Castle/Keep", bounds: [[0,0,0],[8,12,8]] }', "[]", "[[1,1,1],[1,1,1]]"]);
});

test("a positive angle turns the same way as turn()", async () => {
  assert.equal(turnBlock("oak_stairs[facing=north]", 1), "oak_stairs[facing=east]");
  assert.equal(turnBlock("oak_log[axis=x]", 1), "oak_log[axis=z]");
  const scene = await data(`
    model("arm", [{ block: "stone", at: [4, 0, 0] }])
    use("arm", { at: [0, 0, 0], rotate: [0, 90, 0] })
  `);
  // Centre of the unit block: east must go south, as north goes east under turn().
  const m = scene.instances[0].parts[0].matrix;
  const centre = [0, 1, 2].map((axis) => (m[axis] + m[4 + axis] + m[8 + axis]) / 2 + m[12 + axis]);
  assert.deepEqual(centre.map((value) => Math.round(value * 1e6) / 1e6 + 0), [0, 0, 4]);
});

test("children inherit transforms and block parts are centred on their at", async () => {
  const scene = await data(`
    model("inner", [{ block: "stone", at: [1, 0, 0] }])
    model("outer", [{ at: [10, 0, 0], scale: 2, children: [{ model: "inner", at: [0, 1, 0] }] }])
    use("outer", { at: [100, 0, 0] })
  `);
  const m = scene.instances[0].parts[0].matrix;
  assert.deepEqual([m[0], m[5], m[10], m[12], m[13], m[14]], [2, 2, 2, 111, 1, -1]);
});

test("reports follow the build report format", async () => {
  const first = await buildSource('group("Castle", () => group("Keep", () => group("Roof", () => fill([0,0,0],[9,9,11],"stone"))))', null);
  assert.match(first.report, /^\[build ok · \d+ ms\] \+1,200 −0 blocks · Castle\/Keep\/Roof rebuilt$/);
  const second = await buildSource('group("Castle", () => group("Walls", () => fill([0,0,0],[9,9,11],"stone")))\nfill([0,0,0],[0,0,0],"dirt")\nlog({ kind: "group", path: "Castle/Keep", bounds: [[0,0,0],[8,12,8]] })', first.data!);
  assert.deepEqual(second.report.split("\n").slice(1), [
    "warn: build.js:2 overwrote 1 block owned by Castle/Walls",
    'log: { kind: "group", path: "Castle/Keep", bounds: [[0,0,0],[8,12,8]] }',
  ]);
  assert.match(second.report, /\+1 −0 blocks · Ungrouped, Castle\/Keep\/Roof, Castle\/Walls rebuilt/);
  assert.match((await buildSource("", null)).report, /no changes$/);
  assert.equal(await failure('\nset(0,0,0,"oak_planks_stairs")'),
    '[build failed] build.js:2 unknown block "oak_planks_stairs", did you mean "oak_stairs"?');
  assert.match((await buildSource(null, null)).report, /build\.js is missing/);
});

test("carving with air is not reported as an overwrite", async () => {
  assert.deepEqual((await build(example)).warnings, []);
});

test("invalid builds fail with a line", async () => {
  const cases: [string, RegExp][] = [
    ["\nMath.random()", /build\.js:2 Math\.random is not available\. Use rand\(\)/],
    ["new Date()", /Date/],
    ["async function f() { await 1; set(0,0,0,'stone') }\nf()", /asynchronous/],
    ["(async () => 1)().then(() => {})", /asynchronous/],
    ["import('x')", /asynchronous/],
    ["set(0.5,0,0,'stone')", /build\.js:1 Block coordinates must be integers/],
    ['set(0,0,0,"stone*2,dirt")', /build\.js:1 Invalid block/],
    ['model("a", [])\nmodel("a", [])', /build\.js:2 Model "a" is already defined/],
    ['model("a", [{ block: "stone", model: "b", at: [0,0,0] }])', /cannot have both/],
    ['model("a", [{ model: "b", at: [0,0,0] }])\nmodel("b", [{ model: "a", at: [0,0,0] }])', /build\.js:1 Recursive model: a → b → a/],
    ['model("a", [])\nuse("a", { at: [0,0,0], id: "x" })\nuse("a", { at: [0,0,0], id: "x" })', /build\.js:3 Duplicate instance id "x"/],
    ['group("Roof", () => set(0,0,0,"stone"))\nselect("Roff").remove()', /build\.js:2 Nothing matches "Roff"\. Did you mean Roof\?/],
    ['model("a", [{ block: "stone", at: [0, NaN, 0] }])', /finite/],
    ["fill([0,0,0],[1000,1000,1000],'stone')", /2,000,000 block writes/],
    ["try { fill([0,0,0],[1000,1000,1000],'stone') } catch {}", /2,000,000 block writes/],
    ["set(\n\n(", /build\.js:3/],
    ["for (let i = 0; i < 9000; i++) set(i * 16, 0, 0, 'stone')", /8,192/],
    [`//${"x".repeat(262_144)}`, /larger than/],
  ];
  for (const [source, expected] of cases) assert.match(await failure(source), expected, source.slice(0, 80));
});

test("an empty scene has no changes against itself", () => {
  assert.deepEqual(diffScenes(emptyScene(), emptyScene()).rebuilt, []);
});
