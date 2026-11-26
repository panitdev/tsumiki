# Tsumiki — Build Tool Spec (draft)

Nov 22, 2026 · @최건

Tsumiki (積み木, toy building blocks) is an internal toolkit replacing genMC. The goal is **7 tools, one write tool, nothing to think about but blocks**: no revisions, humans watch through a read-only viewer instead of co-editing, no tours or publishing. The agent writes a short script, looks at a render, fixes and saves.

## Existing harnesses

Several MCP servers already do this. Most appeared in Oct–Nov 2026 and have only a handful of commits, so treat them as references or fork bases, not dependencies.

| Project | Approach | Worth taking | Gaps for us |
| --- | --- | --- | --- |
| [WebitroHQ/minecraft-structure-mcp](https://github.com/WebitroHQ/minecraft-structure-mcp) | Python MCP, headless, \~20 tools | Textured iso renders from your own client jar; `layer_text` grid; weighted block mixes (`stone_bricks*6,mossy_stone_bricks`); rotate/mirror that turns stairs and doors | Many small tools; outputs .nbt first, no script tool |
| [BarnieBarnie/schematic-architect](https://github.com/BarnieBarnie/schematic-architect) | Shapes + edits, .litematic export | Palette roles (`primary`, `trim`, `roof`) so one design can swap materials | Shape-per-call; no scripting |
| [harrynull/mcbuild](https://github.com/harrynull/mcbuild) | Agent writes a sandboxed Python DSL, renders contact sheets, self-critiques | Script-first loop; `str_replace` on the last script; line-mapped errors | Standalone agent, not an MCP server |
| [SimoneRecchia/minecraft-schematic-lab](https://github.com/SimoneRecchia/minecraft-schematic-lab) (VibeSchem) | Full builder app with BuildSpec, roof and tree generators | Version-strict block validation, roof generators | Large, closer to genMC in scope |
| [Philogag/deepslate-mcp](https://github.com/Philogag/deepslate-mcp) | Renderer only (misode/deepslate) | Drop-in renderer for .schem / .litematic / .nbt | Rendering only |

**Recommendation:** build it in Panit's stack (see Tech stack). Borrow minecraft-structure-mcp's ideas (layer text, weighted mixes, rotation tables), mcbuild's script-first loop, and [misode/deepslate](https://github.com/misode/deepslate) for the viewer.

## Why not just a Python script

A bare script with a schematic library makes the agent build its own tooling every time. This server adds only what a script can't give cheaply:

- **Eyes.** A textured render after every build, plus a text layer view, so the agent sees mistakes without exporting and loading the game.
- **Block validation with suggestions.** `oak_stair` → "did you mean `oak_stairs`?"; bad states list the valid values.
- **Rotation-aware blocks.** Stairs, doors, logs, fences and rails turn correctly.
- **Persistent state.** The structure lives between calls, so a fix is a 2-line script, not a full rerun.
- **Undo.** Every build call is one step.
- **Auto-checks.** Every build reports floating blocks and unknown blocks without being asked.

## Conventions

- Coordinates: `x` east, `y` up, `z` south. Boxes are `[x1,y1,z1, x2,y2,z2]`, both corners inclusive.
- Blocks: `oak_stairs[facing=north]`; `minecraft:` optional. A mix is `stone_bricks*6,mossy_stone_bricks*2`.
- Every result is `{ok, summary, ...}`. `summary` is one line the agent can repeat to the user.
- Errors: `{ok:false, error, hint, line?}`. Nothing is applied on error.

## The 7 tools

The whole loop is `open` → `build` → `look` → `build` → … → `save`. `read`, `blocks` and `undo` are there when needed.

| Tool | Does |
| --- | --- |
| `open` | Open a structure by name, creating it if new, or import a .schem / .litematic / .nbt |
| `build` | Run a short script against the open structure. The only tool that changes blocks |
| `look` | Render PNG views (iso, top, side, cut-away) |
| `read` | Exact blocks as a text grid per layer, or block counts |
| `blocks` | Find block IDs and their valid states |
| `undo` | Undo the last build call(s) |
| `save` | Write .schem / .litematic / .nbt / .mcfunction, with a material list |

## Tool specs

\* = required. Everything else is optional.

### open

| Param | Default | Meaning |
| --- | --- | --- |
| `name`\* |  | Structure name. Created empty if it doesn't exist |
| `from` |  | Path to a .schem / .litematic / .nbt to import as the starting point |

Returns `bounds`, `blockCount`, top 10 materials, and the viewer URL to give the human. `open` with no args lists existing structures.

### build

| Param | Default | Meaning |
| --- | --- | --- |
| `code`\* |  | Script using the API below. Runs against the current blocks |
| `look` | `"iso_se"` | View to render after the build and return inline; `false` to skip |
| `seed` | random | For `rand` / `noise`; returned so a run can be repeated |

One call = one undo step. Limits: 10 s, 2 M placed blocks.

Returns: `placed`, `removed`, `bounds`, the render, `logs`, and `warnings` (unknown blocks with suggestions, floating groups with boxes). A script error returns the line and message, and applies nothing.

```json
{"code": "fill([0,0,0,12,0,8], 'smooth_stone')\nfill([0,1,0,12,5,8], 'white_concrete')\nfill([1,1,1,11,5,7], 'air')\nset(6,1,0, 'iron_door[facing=north,half=lower]')"}
```

### look

| Param | Default | Meaning |
| --- | --- | --- |
| `views` | `["iso_se"]` | Up to 4 of `iso_ne`, `iso_nw`, `iso_se`, `iso_sw`, `top`, `north`, `south`, `east`, `west`; returned as one contact sheet |
| `box` | whole structure | Frame only this region |
| `cut_y` |  | Hide everything above this height to see inside |

### read

| Param | Default | Meaning |
| --- | --- | --- |
| `y` |  | One layer, or `[y1, y2]` for a range |
| `box` | whole structure | Limit the area |
| `counts` | `false` | Return block counts instead of grids |

Grid format: rows are z (north on top), columns are x, `.` is air, with a legend.

```text
y=1   # white_concrete   D iron_door   . air
######D######
#...........#
#############
```

### blocks

| Param | Meaning |
| --- | --- |
| `q` | Words or a block ID: `"dark stone"`, `"copper"`, `oak_stairs` |

A search returns up to 20 matches with their colour tone. An exact ID returns its valid states and family forms (stairs, slab, wall, fence…).

### undo

| Param | Default | Meaning |
| --- | --- | --- |
| `steps` | 1 | How many build calls to undo |

### save

| Param | Default | Meaning |
| --- | --- | --- |
| `format` | `schem` | `schem`, `litematic`, `nbt` or `mcfunction` |
| `path` | workspace folder | Where to write |
| `version` | `26.3` | Target Java version; blocks that don't exist there are swapped for the nearest older block and listed |

Returns the file path and a material list (items, stacks, shulker boxes).

## Script API

**Language: JavaScript in a QuickJS sandbox** (no file system, no network, no imports; memory and time capped). Safer than a Python subset, and the agent writes it just as well.

**Rule: a function is built in only if bare math can't do it.** Every built-in costs the agent tokens to learn and a choice to make. Shapes (cylinders, spheres, roofs, lines, hollow boxes) are a few lines of loops, so the agent writes them itself.

| Function | Why it's built in |
| --- | --- |
| `set(x, y, z, b)` | The one write primitive |
| `fill(box, b)` | Speed: millions of cells without a JS loop per block |
| `get(x, y, z)` | Read what is already there |
| `turn(b, {rotate, mirror})` | Needs the game's state tables: returns the block with its facing, axis or rail shape turned (`oak_stairs[facing=north]` → `[facing=east]`). Moving the coordinates is the agent's own math |
| `fam(id)` | Needs block data: `{block, stairs, slab, wall, fence, ...}` for a material |
| `rand()` | Seeded, so a run can be repeated |
| `log(...)` | Returned in `logs` |

Every `b` argument takes a block ID, a weighted mix (`'stone_bricks*6,mossy_stone_bricks*2'`) or a function `(x,y,z) => id`. `air` erases.

```js
// a reusable motif is just a function with an offset
const s = fam('deepslate_bricks')
const tower = (ox, oz) => {
  for (let y = 0; y < 14; y++)
    for (let x = -4; x <= 4; x++)
      for (let z = -4; z <= 4; z++) {
        const d = Math.hypot(x, z)
        if (d <= 4 && d > 3) set(ox + x, y, oz + z, s.block)
      }
}
for (const [x, z] of [[0,0], [30,0], [0,30], [30,30]]) tower(x, z)

// copy the west wing (x 0..10) as a mirrored east wing; turn() fixes stairs and doors
for (let x = 0; x <= 10; x++) for (let y = 0; y <= 8; y++) for (let z = 0; z <= 6; z++)
  set(30 - x, y, z, turn(get(x, y, z), {mirror: 'x'}))
```

## Tech stack

**One Next.js app** holds everything: the MCP endpoint is a route handler at `/api/mcp`, and the viewer is a page in the same app. One process, one port, one transport (Streamable HTTP).

| Piece | Choice | Notes |
| --- | --- | --- |
| App | Next.js App Router, self-hosted with `next start` on Node | Not serverless: renders need native `gl`, and scripts can run up to 10 s |
| MCP | `mcp-handler` v2 + `@modelcontextprotocol/server` v2 + `zod` v4 in `app/api/mcp/route.ts` | Claude Code connects to `http://localhost:3000/api/mcp`; stdio-only clients go through `mcp-remote` |
| Script sandbox | `quickjs-emscripten` | Memory limit + interrupt handler for the 10 s cap |
| Storage | Postgres | One row per structure; blocks as compressed 16³ chunks in `bytea`; undo diffs in their own table |
| Renderer | `deepslate` + `gl` on the server for `look`; the same deepslate in the browser for the viewer | One renderer for both, so the agent and the human see the same thing |
| Assets | Client jar path in config, unzipped once and cached | No Mojang files shipped |
| Block data | 26.3 data reports (`blocks.json`), checked in | Exact IDs and states |
| File formats | deepslate's NBT writer + small writers for .schem, .litematic, .nbt | Downloads served from a route |
| UI | React + Charlotte (`@charlotte-ui`) | Viewer chrome; deepslate draws into a canvas component |
| Live updates | A route handler streaming Server-Sent Events | The viewer reloads after each `build` |

The one system dependency: `gl` needs Mesa and a display (`xvfb-run` on a headless server).

## Viewer for humans

The app serves a **read-only 3D page** at `http://localhost:3000/<structure>`. The agent doesn't call it; `open` just returns the URL so the agent can pass it on.

- **What the human can do:** orbit, pan and zoom; slice by Y to see inside each floor; hover a block to see its ID and coordinates; scrub the undo history to watch how the build grew.
- **Live:** the page reloads the structure after every `build` (one Server-Sent Events stream, no websocket library).
- **No editing.** Feedback goes to the agent in chat, e.g. "the roof at 12, 18, 4 is floating". Hover coordinates make that easy to say precisely.
- **Stack:** a React page with Charlotte components and deepslate drawing the structure in a canvas, a page in the same Next.js app.

## Left out

Cut from genMC entirely: tours, spawn and walk mode, redstone simulation, survival feasibility, gallery and publishing, checkpoints, camera and UI control, revision guards, request/wait/finish loops, mandatory named parts, gradient planning. Also no shape helpers (roof, cylinder, sphere, line), fill modes, `replace` or noise: the agent does these with math.

## Open questions

- None right now.
