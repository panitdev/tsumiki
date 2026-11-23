import { decodeProtectedHeader } from "jose";
import { z } from "zod";
import { fetchSurgeJson, loadSurgeMetadata, parsePublicUrl, surgeIssuerConfig, verifySurgeJwt } from "./surge-oauth";

const readScope = "mcp:read";
export const mcpWriteScope = "mcp:write";
const metadataPrefix = "/.well-known/oauth-protected-resource";
const claimsSchema = z.object({
  iss: z.string(),
  aud: z.string(),
  sub: z.string().regex(/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i),
  client_id: z.string().min(1),
  scope: z.string().regex(/^(?:[\x21\x23-\x5B\x5D-\x7E]+(?: [\x21\x23-\x5B\x5D-\x7E]+)*)?$/),
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
  nbf: z.number().int().nonnegative().optional(),
});

type Config = {
  issuer: string;
  resource: URL;
  metadataUrl: URL;
  clientId?: string;
  introspectionToken?: string;
};

export function mcpOAuthConfig(): Config | undefined {
  const { TSUMIKI_OAUTH_RESOURCE: resourceValue, TSUMIKI_OAUTH_MCP_CLIENT_ID: clientId,
    TSUMIKI_OAUTH_INTROSPECTION_TOKEN: introspectionToken, TSUMIKI_OAUTH_CLIENT_ID: browserClientId,
    TSUMIKI_OAUTH_CLIENT_SECRET: browserClientSecret, TSUMIKI_SESSION_SECRET: sessionSecret } = process.env;
  const issuer = surgeIssuerConfig();
  if ([issuer, resourceValue, clientId, introspectionToken, browserClientId, browserClientSecret, sessionSecret]
    .every((value) => value === undefined)) {
    return undefined;
  }
  if (!issuer || !resourceValue || clientId === "" || introspectionToken === "") {
    throw new Error("MCP OAuth configuration is incomplete.");
  }
  const resource = parsePublicUrl(resourceValue);
  if (resource.href !== resourceValue || resource.pathname !== "/api/mcp" || resource.search) {
    throw new Error("Expected TSUMIKI_OAUTH_RESOURCE to be the canonical /api/mcp URL.");
  }
  if (introspectionToken && !/^[A-Za-z0-9._~+\/-]+=*$/.test(introspectionToken)) {
    throw new Error("Invalid Surge introspection service token.");
  }
  return {
    issuer, resource, clientId, introspectionToken,
    metadataUrl: new URL(`${metadataPrefix}${resource.pathname}`, resource.origin),
  };
}

export function mcpOAuthConfigurationError() {
  return Response.json({ error: "Tsumiki MCP OAuth is unavailable." }, { status: 503 });
}

export function mcpResourceMetadata() {
  let config: Config | undefined;
  try {
    config = mcpOAuthConfig();
  } catch {
    return mcpOAuthConfigurationError();
  }
  if (!config) return Response.json({ error: "Resource metadata unavailable." }, { status: 404 });
  return Response.json({
    resource: config.resource.href,
    authorization_servers: [config.issuer],
    scopes_supported: [readScope, mcpWriteScope],
    bearer_methods_supported: ["header"],
  }, { headers: { "Cache-Control": "public, max-age=300" } });
}

function challenge(config: Config, error?: "invalid_token" | "insufficient_scope", scope?: string) {
  const params = [`resource_metadata="${config.metadataUrl.href}"`];
  if (error) params.push(`error="${error}"`);
  if (scope) params.push(`scope="${scope}"`);
  return Response.json({ error: error ?? "Tsumiki MCP authorization required." }, {
    status: error === "insufficient_scope" ? 403 : 401,
    headers: { "WWW-Authenticate": `Bearer ${params.join(", ")}`, "Cache-Control": "no-store" },
  });
}

async function verifyAccessToken(config: Config, token: string) {
  const header = decodeProtectedHeader(token);
  if (header.typ !== "at+jwt" || header.alg !== "ES256" || typeof header.kid !== "string" || !header.kid) {
    throw new Error("Invalid Surge access-token header.");
  }
  const metadata = await loadSurgeMetadata(config.issuer);
  let payload: unknown;
  if (config.introspectionToken) {
    if (!metadata.introspectionEndpoint) throw new Error("Surge does not advertise introspection.");
    const result = await fetchSurgeJson(metadata.introspectionEndpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.introspectionToken}` },
      body: new URLSearchParams({ token, token_type_hint: "access_token" }),
    });
    payload = z.object({ active: z.literal(true), token_type: z.literal("Bearer") }).passthrough().parse(result);
  } else {
    ({ payload } = await verifySurgeJwt(config.issuer, metadata.jwksUri, token, {
      audience: config.resource.href, typ: "at+jwt",
    }));
  }
  const claims = claimsSchema.parse(payload);
  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== config.issuer || claims.aud !== config.resource.href ||
      (config.clientId !== undefined && claims.client_id !== config.clientId) ||
      claims.iat > now || claims.exp <= now || claims.exp <= claims.iat || (claims.nbf ?? 0) > now) {
    throw new Error("Invalid Surge access-token claims.");
  }
  return { subject: claims.sub.toLowerCase(), scopes: new Set(claims.scope.split(" ")) };
}

const toolCallSchema = z.object({
  method: z.literal("tools/call"),
  params: z.object({ name: z.string(), arguments: z.record(z.string(), z.unknown()).optional() }),
});

function writesStructure(input: unknown) {
  const call = toolCallSchema.safeParse(input);
  if (!call.success) return false; // The MCP transport rejects malformed tool calls.
  const { name, arguments: args } = call.data.params;
  return ["build", "undo", "save"].includes(name) || (name === "open" && args?.name !== undefined);
}

export async function authorizeMcpOAuth(request: Request, config: Config) {
  const authorization = request.headers.get("Authorization");
  if (authorization === null) return challenge(config);
  const token = /^Bearer ([\w-]+\.[\w-]+\.[\w-]+)$/i.exec(authorization)?.[1];
  if (!token || token.length > 8192) return challenge(config, "invalid_token");
  let identity: Awaited<ReturnType<typeof verifyAccessToken>>;
  try {
    identity = await verifyAccessToken(config, token);
  } catch {
    return challenge(config, "invalid_token");
  }
  if (!identity.scopes.has(readScope)) return challenge(config, "insufficient_scope", readScope);
  if (request.method === "POST" && !identity.scopes.has(mcpWriteScope) &&
      request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
    let input: unknown;
    try {
      input = await request.clone().json();
    } catch {
      return Response.json({ error: "Expected a JSON-RPC request." }, { status: 400 });
    }
    const calls = Array.isArray(input) ? input : [input];
    if (calls.some(writesStructure)) return challenge(config, "insufficient_scope", `${readScope} ${mcpWriteScope}`);
  }
  return identity;
}
