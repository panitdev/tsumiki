import assert from "node:assert/strict";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { download, saveBuild } from "../src/server/files";
import { workspaceSelection } from "../src/server/workspace-access";

const first = "bedc4ae0-9c3d-4d1b-a40d-ddd7ea07dce6";
const second = "ebc176a5-8abc-453e-8ee6-ab3669a4e68c";

test("workspace labels select separately for each verified subject", () => {
  assert.equal(workspaceSelection("default"), "default");
  assert.notEqual(workspaceSelection("default", first), workspaceSelection("default"));
  assert.notEqual(workspaceSelection("default", first), workspaceSelection("default", second));
  assert.notEqual(workspaceSelection("default", first), workspaceSelection("alternate", first));
});

test("exports and downloads use the verified subject's directory", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "tsumiki-workspaces-"));
  const previousRoot = process.env.TSUMIKI_WORKSPACE;
  process.env.TSUMIKI_WORKSPACE = root;
  t.after(async () => {
    if (previousRoot === undefined) delete process.env.TSUMIKI_WORKSPACE;
    else process.env.TSUMIKI_WORKSPACE = previousRoot;
    await rm(root, { recursive: true, force: true });
  });

  const build = {
    groups: [{ name: "", parent: -1 }], states: ["stone"], runs: [0, 0, 0, 1, 0, 0], instances: [],
  };
  const options = { format: "nbt", version: "26.3" } as const;
  const saved = await saveBuild("house", build, options, first);
  const id = saved.downloadUrl.split("/").at(-1)!;
  assert.equal((await download(id, first))?.name, "house.nbt");
  assert.equal(await download(id, second), undefined);
  assert.equal(await download(id), undefined);

  const other = await saveBuild("house", build, options, second);
  assert.notEqual(saved.path, other.path);
  await assert.rejects(saveBuild("house", build, { ...options, path: saved.path }, second), /outside the workspace/);
  await assert.rejects(saveBuild("house", build, { ...options, path: "../escape.nbt" }, second), /outside the workspace/);
  await symlink(dirname(saved.path), other.path.replace(/house\.nbt$/, "link"));
  await assert.rejects(saveBuild("house", build, { ...options, path: "link/house.nbt" }, second), /outside the workspace/);
});
