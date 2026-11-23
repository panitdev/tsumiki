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

Set `DATABASE_URL` and configure Surge OAuth in `/opt/tsumiki/.env` as shown below. For a static-token deployment, set a generated `TSUMIKI_MCP_TOKEN` and omit the OAuth and session variables entirely. The static token protects MCP and the browser viewer is public. Compose requires an OAuth issuer or a static token. Use `docker compose pull` and `docker compose up -d` from `/opt/tsumiki`. After the first image is published, add the entry from `ops/polling-target.txt` to the services array in `/opt/polling-deploy/poll.ts`. The existing systemd timer picks up future GHCR digests.

The existing Cloudflare Tunnel and Traefik network serve the viewer at [tsumiki.panit.dev](https://tsumiki.panit.dev). Compose uses the same HTTPS origin for viewer links and the browser sign-in callback. Set `TSUMIKI_HOST` to use another hostname routed through the tunnel, and use that origin in the Surge registrations and Tsumiki settings. The service remains reachable on host loopback port 3017 for diagnostics.

### Register Tsumiki with Surge

On the central Surge deployment, set `SURGE_OAUTH_ISSUER` to its canonical public origin and enable OIDC (`SURGE_OAUTH_ENABLE_OIDC=1`, the default). Run the following commands against that deployment's Surge database. Replace the issuer example and use the exact OAuth callback URL supplied by your MCP client. Create the service and resource once, then create the separate browser and MCP registrations. Use a client that accepts a pre-registered OAuth client ID and supports Streamable HTTP, OAuth resource discovery, and authorization code with S256 PKCE.

```sh
surge-server svc create --name tsumiki --grant introspect --origin https://auth.example.com
surge-server oauth resource create \
  --uri https://tsumiki.panit.dev/api/mcp --service tsumiki \
  --scope mcp:read --scope mcp:write \
  --describe 'mcp:read=Inspect Tsumiki structures' \
  --describe 'mcp:write=Open, edit, and export Tsumiki structures'
surge-server oauth client create --name 'Tsumiki Viewer' --confidential \
  --redirect-uri https://tsumiki.panit.dev/auth/callback
surge-server oauth client create --name 'Tsumiki MCP' \
  --redirect-uri '<exact MCP client callback URL>' \
  --scope mcp:read --scope mcp:write
```

The viewer requests `openid` for browser sign-in. Configure the MCP client with its own client ID and the `https://tsumiki.panit.dev/api/mcp` endpoint. Request `mcp:read` for inspection and add `mcp:write` for selecting or creating a named structure, building, undoing, or exporting.

Set these values in Tsumiki's environment with the IDs and secret from the registrations. Generate the session secret with `openssl rand -hex 32` and keep it stable across restarts. Omit unused variables entirely, including the static bearer token in OAuth mode.

```dotenv
TSUMIKI_BASE_URL=https://tsumiki.panit.dev
TSUMIKI_OAUTH_ISSUER=https://auth.example.com
TSUMIKI_OAUTH_RESOURCE=https://tsumiki.panit.dev/api/mcp
TSUMIKI_OAUTH_CLIENT_ID=<browser client ID>
TSUMIKI_OAUTH_CLIENT_SECRET=<browser client secret>
TSUMIKI_OAUTH_MCP_CLIENT_ID=<MCP client ID>
TSUMIKI_SESSION_SECRET=<64 hex characters>
```

Optionally set `TSUMIKI_OAUTH_INTROSPECTION_TOKEN` to the **service token** for the resource owner with the `introspect` grant. Tsumiki then checks each MCP access token with Surge for current revocation status. With that variable omitted, Tsumiki verifies access tokens locally using Surge's published signing keys and accepts a valid token until it expires.

### Verify the deployment

Check that the unauthenticated MCP request returns HTTP 401 with a Bearer challenge pointing to the metadata below. The metadata should report the exact MCP URL, the Surge issuer, and the two MCP scopes.

```sh
curl -i https://tsumiki.panit.dev/api/mcp
curl -fsS https://tsumiki.panit.dev/.well-known/oauth-protected-resource/api/mcp
```

In a browser, open the viewer, sign in through Surge, and confirm that the structure list loads. Sign out and try opening a structure again. In the MCP client, complete authorization and call `open({})` to list structures. With both scopes, select a structure and try `save`. Open the returned download URL in a browser signed in to the same Surge account.

### Move workspace files from a static-token deployment

Structures and build history already in Postgres are shared across signed-in users, subject to the MCP client's scopes. Each Surge account has its own active structure selection for each `X-Tsumiki-Workspace` value. Reselect an existing structure by name on the first connection.

With OAuth, import and export paths are relative to `TSUMIKI_WORKSPACE/.tsumiki-users/<sha256>`, where `<sha256>` is the SHA-256 hex digest of the lowercase Surge subject UUID. On panit this is under `/opt/tsumiki/workspace/.tsumiki-users`. To reuse an existing import or exported file, copy it from the old workspace into the owning account's directory. Keep the directory and files accessible to container UID 1000. Regenerate old download links with `save` under the intended account.
