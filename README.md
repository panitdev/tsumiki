# Tsumiki

Tsumiki is a TypeScript MCP server for building Minecraft Java Edition structures. Each project is one JavaScript file, `/project/build.js`. Agents edit it in a sandboxed shell, Tsumiki rebuilds it from scratch after every change, and agents render the result to PNG. Humans follow along in a read-only browser viewer.

> **Upgrading from the earlier release deletes its data.** The block-map storage behind the `build`, `look`, `read` and `blocks` tools cannot be expressed as a `build.js`. On its first database request this release runs `DROP TABLE` on `tsumiki_structures`, `tsumiki_chunks`, `tsumiki_history` and `tsumiki_workspaces`, which permanently removes every existing structure and its history. Export anything you need with the earlier release, or back up the database, before deploying. Pushing to `main` publishes the image that panit deploys automatically.

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

Set `TSUMIKI_MCP_TOKEN` in the server environment to require `Authorization: Bearer <token>` on the endpoint. Set the optional `X-Tsumiki-Workspace` header to give each MCP client its own active project selection. Without that header, clients share the default selection. Projects are shared across workspaces, and their files, revisions and last good build persist in Postgres.

## Tools

| Tool | Purpose |
| --- | --- |
| `open` | Without a name, list projects and viewer links. With a name, switch to a project or create it. `reset: true` empties `build.js`. |
| `bash` | A [bashkit](https://bashkit.sh) shell over the project's virtual filesystem. A call that changes `build.js` triggers a build, and the report is appended to the output. |
| `render` | One PNG of the last good build from `camera: {from, at}`. `hide` takes a selector. `section: [[x1,y1,z1],[x2,y2,z2]]` shows only that inclusive box of cells. |
| `undo` | Restore `build.js` from before the last changing call, or several with `steps`, then rebuild. |
| `save` | Export the last good build to the workspace as `.schem`, `.litematic`, `.nbt` or `.mcfunction`. |

A failed build keeps your edit, while `render`, the viewer and exports continue to use the last good build. The `bash` tool description carries the full script reference; [src/server/mcp-guide.ts](src/server/mcp-guide.ts) is its source.

```sh
cat > /project/build.js <<'EOF'
model("lamp", [{ block: "lantern", at: [0.5, 0.5, 0.5], scale: 1.5 }], { tags: ["light"] })

function house([x, y, z]) {
  group("Walls", () => fill([x, y, z], [x + 6, y + 4, z + 6], "oak_planks"))
  group("Interior", () => fill([x + 1, y + 1, z + 1], [x + 5, y + 4, z + 5], "air"))
  group("Door", () => fill([x + 3, y + 1, z], [x + 3, y + 2, z], "air"))
}

group("Village", () => house([0, 0, 0]))
group("Street", () => use("lamp", { at: [3, 6, -3] }))
log(select("Village Walls"))
EOF
```

The script API is `set`, `fill(from, to, block)`, `get`, `turn(block, quarterTurns)`, `rand`, `log`, `group`, `model`, `use` and `select`. Conventions that matter:

- A positive `rotate` angle is clockwise seen from the positive end of its axis, applied about X, then Y, then Z. `[0,90,0]` turns the same way as `turn(block, 1)`.
- A block display is centred on its `at` and scales in both directions from there.
- `rand()` and generated instance ids depend only on their group, so editing one group does not reshuffle another.
- Replacing another group's block with a non-air block produces a warning. Carving with air does not.
- `(0,0,0)` is the paste point. Structure `.nbt` files cannot store a paste offset, so `save` reports where their minimum corner goes. Block displays export as `block_display` entities and are omitted for releases before 1.19.4.

### Limits

| What | Limit |
| --- | --- |
| Build | 10 s, 2,000,000 block writes, 64 MiB of script memory, 8,192 partly filled 16³ sections |
| Source | `build.js` up to 256 KiB |
| Models | 20,000 block parts and 10,000 instances per build |
| Shell call | 10 s, 10,000 commands, 10,000 iterations per loop and 100,000 in total |
| Shell output | bashkit's `Hardened` preset, then trimmed to 30,000 characters |
| Stored project | 64 files and 1 MiB under `/project`. A call that exceeds this saves none of its file changes. |

bashkit 0.22.0's JavaScript wrapper cannot set an exact output limit and offers no filesystem limit settings. Its fixed 10 MB per file and 100 MB total apply while a command runs; the stored-project limit above is Tsumiki's own. Each call starts a new shell, so only files under `/project` carry over.

Builds run synchronously in the server process. A slow script delays other requests for up to 10 seconds.

The viewer shows the group tree with hide, isolate and select, draws block displays, slices by Y, and downloads any export format. Material lists count placement items for grid blocks using the 26.3 stack sizes and report technical blocks separately. `save` destinations are confined to `TSUMIKI_WORKSPACE` (default `workspace/`) and its download URLs are unique. Block entities and item inventories are not exported. The default export targets 26.3. Older Java versions from 1.13 onward use versioned block data over HTTPS and report block ID substitutions. The exporter uses [mcmeta](https://github.com/misode/mcmeta) with a pinned [PrismarineJS catalog](https://github.com/PrismarineJS/minecraft-data) for releases without reports.

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

If browser sign-in fails with Surge’s `invalid_target` error, verify that `TSUMIKI_OAUTH_CLIENT_ID` identifies the viewer registration and that Surge permits that client to request the exact URI configured in `TSUMIKI_OAUTH_RESOURCE`. Check the viewer client’s resource policy before retrying sign-in.

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

In a browser, open the viewer, sign in through Surge, and confirm that the structure list loads. Sign out and try opening a structure again. In the MCP client, complete authorization and call `open({})` to list projects. With both scopes, open a project and try `save`. Open the returned download URL in a browser signed in to the same Surge account.

### Move workspace files from a static-token deployment

Projects in Postgres are shared across signed-in users, subject to the MCP client's scopes. Each Surge account has its own active project selection for each `X-Tsumiki-Workspace` value. Reopen a project by name on the first connection.

With OAuth, `save` paths are relative to `TSUMIKI_WORKSPACE/.tsumiki-users/<sha256>`, where `<sha256>` is the SHA-256 hex digest of the lowercase Surge subject UUID. On panit this is under `/opt/tsumiki/workspace/.tsumiki-users`. To reuse an exported file, copy it from the old workspace into the owning account's directory. Keep the directory and files accessible to container UID 1000. Regenerate old download links with `save` under the intended account.
