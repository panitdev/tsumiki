import assert from "node:assert/strict";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { download, importStructure, saveStructure } from "../src/server/files";
import type { StructureInfo } from "../src/server/store";
import { workspaceSelection } from "../src/server/workspace-access";

const first = "bedc4ae0-9c3d-4d1b-a40d-ddd7ea07dce6";
const second = "ebc176a5-8abc-453e-8ee6-ab3669a4e68c";

test("workspace labels select separately for each verified subject", () => {
  assert.equal(workspaceSelection("default"), "default");
  assert.notEqual(workspaceSelection("default", first), workspaceSelection("default"));
  assert.notEqual(workspaceSelection("default", first), workspaceSelection("default", second));
  assert.notEqual(workspaceSelection("default", first), workspaceSelection("alternate", first));
});

test("exports, downloads and imports use the verified subject's directory", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "tsumiki-workspaces-"));
  const previousRoot = process.env.TSUMIKI_WORKSPACE;
  process.env.TSUMIKI_WORKSPACE = root;
  t.after(async () => {
    if (previousRoot === undefined) delete process.env.TSUMIKI_WORKSPACE;
    else process.env.TSUMIKI_WORKSPACE = previousRoot;
    await rm(root, { recursive: true, force: true });
  });

  const info: StructureInfo = { name: "house", bounds: [0, 0, 0, 0, 0, 0], blockCount: 1, historyDepth: 0, version: 0 };
  const blocks = new Map([["0,0,0", "stone"]]);
  const options = { format: "nbt", version: "26.3" } as const;
  const saved = await saveStructure(info, blocks, options, first);
  const id = saved.downloadUrl.split("/").at(-1)!;
  assert.equal((await download(id, first))?.name, "house.nbt");
  assert.equal(await download(id, second), undefined);
  assert.equal(await download(id), undefined);
  assert.deepEqual(await importStructure("house.nbt", first), blocks);
  await assert.rejects(importStructure(saved.path, second), /outside the workspace/);
  await assert.rejects(importStructure(saved.path), /outside the workspace/);

  const other = await saveStructure(info, blocks, options, second);
  assert.notEqual(saved.path, other.path);
  const link = other.path.replace(/house\.nbt$/, "link.nbt");
  await symlink(saved.path, link);
  await assert.rejects(importStructure("link.nbt", second), /outside the workspace/);
});
