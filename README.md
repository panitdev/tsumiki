# Tsumiki

Tsumiki is a TypeScript MCP server for building Minecraft Java Edition structures. Agents run short QuickJS scripts and inspect rendered PNGs or text grids. Humans can follow the same structure in a read-only browser viewer.

## Local setup

Use Node 22.23.5, Postgres, and your Minecraft Java 26.3 client jar. On Debian or Ubuntu, install `build-essential python3 python-is-python3 pkg-config libxi-dev libxext-dev libx11-dev mesa-common-dev libgl1-mesa-dev libegl1 xauth xvfb` before installing the Node dependencies.

```sh
npm ci
cp .env.example .env.local
createdb tsumiki
xvfb-run -a npm run dev
```

Set `DATABASE_URL` in `.env.local` to match your PostgreSQL role and set `MINECRAFT_CLIENT_JAR` to your client jar. Use `LIBGL_ALWAYS_SOFTWARE=1` for software rendering with Mesa. The first request initializes the database schema. Tsumiki extracts rendering assets at runtime and keeps them in memory. The repository and image contain no client jar or texture assets.

Add the Streamable HTTP endpoint to Claude Code.

```sh
claude mcp add --transport http tsumiki http://localhost:3000/api/mcp
```

Set `TSUMIKI_MCP_TOKEN` in the server environment to require `Authorization: Bearer <token>` on the endpoint. Set the optional `X-Tsumiki-Workspace` header to give each MCP client its own active structure selection. Without that header, clients share the default selection. Named structures are shared across workspaces and their build history persists in Postgres.

Call `open({})` to discover existing names and viewer links. Call `open({name})` to select a structure for the current workspace or create it if the name is new. `build` runs a script, `look` or `read` inspects the structure, and `save` exports it. `blocks` searches the Java 26.3 catalog, and `undo` rolls back whole build calls. Build counts represent net coordinate changes. Changing an existing non-air state counts as one placement. The returned PNG is MCP image content. Set `look:false` to skip it.

```js
fill([0, 0, 0, 8, 0, 8], 'stone_bricks*6,mossy_stone_bricks*2')
fill([2, 1, 2, 6, 4, 6], 'white_concrete')
fill([3, 1, 3, 5, 4, 5], 'air')
set(4, 1, 2, 'iron_door[facing=north,half=lower]')
set(4, 2, 2, 'iron_door[facing=north,half=upper]')
```

Import files and export destinations are confined to `TSUMIKI_WORKSPACE` (default `workspace/`). The formats cover block states. Block entities, item inventories and entities are omitted. The default export targets 26.3. Older Java versions from 1.13 onward use versioned block data over HTTPS and report block ID substitutions. The exporter uses [mcmeta](https://github.com/misode/mcmeta) with a pinned [PrismarineJS catalog](https://github.com/PrismarineJS/minecraft-data) for releases without reports. Material lists count placement items using the 26.3 stack sizes and report technical blocks separately. Export downloads use unique URLs.

## Deployment on panit

GitHub Actions verifies the app against Postgres and runs a production smoke test with software WebGL. A successful build on `main` publishes an image to GHCR with the commit SHA and `latest` tags.

Install `ops/compose.yml` at `/opt/tsumiki/compose.yml`. Use a dedicated PostgreSQL database and role on `shared-postgres`, reachable on `shared-internal`. Put the Minecraft Java 26.3 client jar at `/opt/tsumiki/assets/client.jar` and make `/opt/tsumiki/workspace` writable by container UID 1000. The 26.3 jar SHA-1 is `e877b6a07acd633fb3bb475002175cec036e7b87`.

Set `DATABASE_URL` and a generated `TSUMIKI_MCP_TOKEN` in `/opt/tsumiki/.env`. Use `docker compose pull` and `docker compose up -d` from `/opt/tsumiki`. After the first image is published, add the entry from `ops/polling-target.txt` to the services array in `/opt/polling-deploy/poll.ts`. The existing systemd timer picks up future GHCR digests.

The existing Cloudflare Tunnel and Traefik network serve the viewer at [tsumiki.panit.dev](https://tsumiki.panit.dev). Open **Connect an agent** for the MCP URL and request headers. Configure MCP clients to use `https://tsumiki.panit.dev/api/mcp` with the deployment's bearer token. Compose uses the same HTTPS origin for generated links. Set `TSUMIKI_HOST` to use another hostname routed through the tunnel. The service remains reachable on host loopback port 3017 for diagnostics.
