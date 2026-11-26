import assert from "node:assert/strict";
import test from "node:test";
import { runShell } from "../src/server/shell";

test("the shell edits project files with standard builtins and keeps only what is under /project", async () => {
  const first = await runShell({ "build.js": "" }, `cat > build.js <<'END'
fill([0,0,0], [1,1,1], "stone")
END
sed -i 's/stone/oak_planks/' build.js
grep -c oak_planks build.js; echo scratch > /tmp/elsewhere; mkdir notes; echo hi > notes/a; X=1`);
  assert.equal(first.exitCode, 0, first.stderr);
  assert.equal(first.stdout, "1\n");
  assert.deepEqual({ ...first.files }, { "build.js": 'fill([0,0,0], [1,1,1], "oak_planks")\n', "notes/a": "hi\n" });
  const second = await runShell(first.files!, 'cat build.js notes/a; cat /tmp/elsewhere; echo "x=$X"; pwd');
  assert.equal(second.stdout, 'fill([0,0,0], [1,1,1], "oak_planks")\nhi\nx=\n/project\n');
});

test("the shell has no Python, git or network", async () => {
  for (const command of ["python3 -c 'print(1)'", "python -V", "git init", "curl -s https://example.com"]) {
    assert.notEqual((await runShell({}, command)).exitCode, 0, command);
  }
});

test("runaway commands stop at a limit", async () => {
  for (const command of ["while true; do :; done", "sleep 60"]) {
    const result = await runShell({}, command);
    assert.notEqual(result.exitCode, 0, command);
    assert.match(result.stderr, /limit|timeout/i, command);
  }
});

test("long output is trimmed", async () => {
  const result = await runShell({}, "for i in $(seq 1 3000); do echo 0123456789012345678901234567890123456789; done");
  assert(result.stdout.length < 31_000);
  assert.match(result.stdout, /output trimmed/);
});

test("a build.js near the size limit can be printed and edited", async () => {
  const source = `//${"x".repeat(97)}\n`.repeat(2_500);
  const result = await runShell({ "build.js": source }, "sed -i '1s/x/y/' build.js; cat build.js > /tmp/copy; wc -c < /tmp/copy");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout.trim(), String(source.length));
  assert.equal(result.files!["build.js"].length, source.length);
});

test("oversized projects are not saved, and links are not followed", async () => {
  const large = await runShell({ "build.js": "" }, "head -c 700000 /dev/zero | tr '\\0' a > one; cp one two");
  assert.equal(large.files, null);
  assert.match(large.notes.join("\n"), /none of this call's file changes were saved/);
  const linked = await runShell({}, "ln -s /etc/passwd build.js");
  assert.deepEqual({ ...linked.files }, {});
  assert.match(linked.notes.join("\n"), /not a regular file/);
  const removed = await runShell({ "build.js": "x" }, "cd /; rm -rf /project");
  assert.deepEqual({ ...removed.files }, {});
});
