export const INSTRUCTIONS = [
  "Tsumiki builds Minecraft Java Edition structures from one JavaScript file per project, /project/build.js.",
  "Call open with no arguments to list projects, then open with a name before using any other tool; a new name creates a project.",
  "Share the project's viewerUrl with the user.",
  "Edit build.js with the bash tool, which rebuilds it from scratch whenever it changes, and look at the result with render.",
  "The bash tool's description holds the script API.",
].join(" ");

export const BASH_DESCRIPTION = `Run a command in a sandboxed virtual shell (cat, heredocs, sed, awk, grep, diff; no Python, git or network). The working directory is /project. Each call starts a new shell: files under /project persist (up to 64 files and 1 MiB), but variables, cwd and files elsewhere do not. Edit /project/build.js, the project's only source file (at most 256 KiB). Output beyond 30,000 characters is trimmed.

After a call that changes build.js, it is rebuilt from scratch and a report is appended: "[build ok · N ms] +added −removed blocks · groups rebuilt", then warn: and log: lines; or "[build failed] build.js:LINE message". After a failure your edit stays, and render, the viewer and export keep the last good build. Each call that changes build.js is one undo step. To inspect the build, add log(select(...)) or log(get(x,y,z)) to build.js and read the next report.

BUILD SCRIPT (synchronous JavaScript; no imports, Date, Math.random or async; limits: 10 s, 2,000,000 block writes)
Coordinates are Minecraft's: x east, y up, z south (north is -z). One global frame; negatives are fine. (0,0,0) is an anchor you choose and the paste point on export.
set(x, y, z, block)        Place one block. About 250,000 calls per second; prefer fill for regions.
fill(from, to, block)      Fill [x,y,z] to [x,y,z], inclusive: fill([0,0,0],[4,3,4]) is 5×4×5.
get(x, y, z)               The state placed so far, or "air".
turn(block, quarterTurns)  The block turned clockwise seen from above: turn("oak_stairs[facing=north]", 1) faces east.
rand()                     A number in [0,1), seeded by the current group path and call count, so editing one group leaves others unchanged.
log(...values)             Print in the build report.
Blocks are IDs with optional states, such as "oak_stairs[facing=north,half=top]". "air" removes. Unknown IDs fail the build.
Code order is build order. The last placement wins and moves the block to the group that placed it. Replacing another group's block with a non-air block is reported as a warning. To change something, edit the code that builds it.

group(name, () => {...})   Blocks and instances belong to the innermost running group, else to "Ungrouped". Reusing a name under the same parent merges into it. Groups have no local coordinates; for reuse, write a function that takes an origin. Names cannot contain / or quotes.

MODELS are block display entities, for shapes the grid cannot make. They occupy no cells.
model(name, parts, {tags?})   Define without placing. A part is {block, at, rotate?, scale?, children?}, {model, at, rotate?, scale?, children?}, or a pivot {at, rotate?, scale?, children}.
use(name, {at, rotate?, scale?, id?, tags?})   Place an instance and get its id (default "Group/Path/name-1").
Model coordinates are local and the origin is the pivot; block (x,y,z) of the grid spans x..x+1 in the same units. A block part is a full block centred on its at, so scale grows it both ways: a part at y 0.5 with scale [1,4,1] spans y -1.5 to 2.5. Every node rotates and scales about its own at, and children are placed relative to it (child world = parent × child). rotate is [x,y,z] degrees applied about X, then Y, then Z (fixed axes); a positive angle is clockwise seen from the positive end of that axis, so [0,90,0] turns the same way as turn(block, 1). scale is a number or [x,y,z].

select(selector)           Matches among what has been built so far, as [{kind, id, model, tags, path, bounds}] (groups have kind, path, bounds). bounds is [[minX,minY,minZ],[maxX,maxY,maxZ]] in inclusive cells.
select(selector).remove()  Remove matches; a group takes its blocks, instances and subgroups. Fails if nothing matches.
Selectors: Castle (group; quote spaces: "Market Street"), @lamp (instances of a model), .light (tag), #lamp-3 (instance id; quote ids that contain spaces: #"Market Street/lamp-1"), "A .light" (inside A at any depth), "Street > @lamp" (direct child), @lamp.broken (both). Nothing selects the parts inside an instance; edit the model instead.`;
