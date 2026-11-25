import assert from "node:assert/strict";
import test from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { authorizeMcpOAuth, mcpOAuthConfig, mcpResourceMetadata } from "../src/server/mcp-oauth";

const resource = "https://tsumiki.example/api/mcp";
const subject = "bc70528f-5392-45a1-87f8-6e18bf3bb483";
const clientId = "tsumiki-mcp";
const claims = { sub: subject, aud: resource, client_id: clientId, scope: "mcp:read" };

function options(issuer: string, introspectionToken?: string) {
  return {
    issuer, resource: new URL(resource), clientId, introspectionToken,
    metadataUrl: new URL("/.well-known/oauth-protected-resource/api/mcp", resource),
  };
}

function request(token?: string, name?: string, args?: Record<string, unknown>) {
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (name === undefined) return new Request(resource, { headers });
  headers.set("Content-Type", "application/json");
  return new Request(resource, {
    headers, method: "POST",
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
}

function status(result: Awaited<ReturnType<typeof authorizeMcpOAuth>>, expected: number) {
  assert(result instanceof Response);
  assert.equal(result.status, expected);
  return result;
}

function metadata(issuer: string) {
  return {
    issuer, authorization_endpoint: `${issuer}/oauth2/authorize`, token_endpoint: `${issuer}/oauth2/token`,
    jwks_uri: `${issuer}/oauth2/jwks.json`, introspection_endpoint: `${issuer}/oauth2/introspect`,
  };
}

test("MCP discovery is public in OAuth mode and partial OAuth configuration fails closed", async () => {
  const variables = ["TSUMIKI_OAUTH_ISSUER", "TSUMIKI_OAUTH_RESOURCE",
    "TSUMIKI_OAUTH_MCP_CLIENT_ID", "TSUMIKI_OAUTH_INTROSPECTION_TOKEN",
    "TSUMIKI_OAUTH_CLIENT_ID", "TSUMIKI_OAUTH_CLIENT_SECRET", "TSUMIKI_SESSION_SECRET"];
  const old = variables.map((key) => process.env[key]);
  try {
    for (const key of variables) delete process.env[key];
    assert.equal(mcpOAuthConfig(), undefined);
    assert.equal(mcpResourceMetadata().status, 404);

    for (const key of variables.slice(2)) {
      process.env[key] = "configured";
      assert.throws(mcpOAuthConfig);
      assert.equal(mcpResourceMetadata().status, 503);
      delete process.env[key];
    }

    process.env.TSUMIKI_OAUTH_MCP_CLIENT_ID = clientId;
    process.env.TSUMIKI_OAUTH_ISSUER = "https://auth.example";
    process.env.TSUMIKI_OAUTH_RESOURCE = resource;
    assert.deepEqual(await mcpResourceMetadata().json(), {
      resource, authorization_servers: ["https://auth.example"],
      scopes_supported: ["mcp:read", "mcp:write"], bearer_methods_supported: ["header"],
    });
  } finally {
    for (const [index, key] of variables.entries()) {
      const value = old[index];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("MCP verifies Surge ES256 access tokens and challenges for missing scopes", async (t) => {
  const issuer = "https://jwt.auth.example";
  const config = options(issuer);
  const { privateKey, publicKey } = await generateKeyPair("ES256");
  const key = { ...await exportJWK(publicKey), kid: "surge-key", alg: "ES256", use: "sig" };
  t.mock.method(globalThis, "fetch", async (input: URL | string) => {
    const url = new URL(input);
    assert.equal(url.origin, issuer);
    switch (url.pathname) {
      case "/.well-known/oauth-authorization-server": return Response.json(metadata(issuer));
      case "/oauth2/jwks.json": return Response.json({ keys: [key] });
      default: throw new Error("Unexpected OAuth endpoint.");
    }
  });
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-01-01T00:00:00Z") });
  const now = Math.floor(Date.now() / 1000);
  const sign = (overrides = {}, typ = "at+jwt", signingKey = privateKey) =>
    new SignJWT({ ...claims, iss: issuer, iat: now - 10, exp: now + 60, ...overrides })
      .setProtectedHeader({ alg: "ES256", kid: key.kid, typ }).sign(signingKey);

  const challenge = status(await authorizeMcpOAuth(request(), config), 401);
  assert.equal(challenge.headers.get("WWW-Authenticate"), `Bearer resource_metadata="${config.metadataUrl}"`);
  const readToken = await sign();
  assert.deepEqual(await authorizeMcpOAuth(request(readToken, "open"), config), {
    subject, scopes: new Set(["mcp:read"]),
  });
  for (const name of ["open", "build", "undo", "save"]) {
    const result = status(await authorizeMcpOAuth(request(readToken, name, { name: "house" }), config), 403);
    assert.match(result.headers.get("WWW-Authenticate") ?? "", /error="insufficient_scope".*scope="mcp:read mcp:write"/);
  }
  const writeToken = await sign({ scope: "mcp:read mcp:write" });
  assert.deepEqual(await authorizeMcpOAuth(request(writeToken, "build"), config), {
    subject, scopes: new Set(["mcp:read", "mcp:write"]),
  });
  for (const changes of [
    { aud: "https://unrelated.example/api/mcp" }, { aud: [resource] }, { iss: "https://untrusted.example" },
    { client_id: "other" }, { exp: now - 1 }, { iat: now + 1 }, { nbf: now + 60 }, { sub: "default" },
  ]) {
    const result = status(await authorizeMcpOAuth(request(await sign(changes)), config), 401);
    assert.match(result.headers.get("WWW-Authenticate") ?? "", /error="invalid_token"/);
  }
  const otherKey = await generateKeyPair("ES256");
  status(await authorizeMcpOAuth(request(await sign({}, "at+jwt", otherKey.privateKey)), config), 401);
  status(await authorizeMcpOAuth(request(await sign({}, "JWT")), config), 401);
  status(await authorizeMcpOAuth(request(await sign({ scope: "mcp:write" })), config), 403);
});

test("MCP introspection requires active access-token claims for the configured resource and client", async (t) => {
  const issuer = "https://introspection.auth.example";
  const config = options(issuer, "surge-service-token");
  const { privateKey } = await generateKeyPair("ES256");
  const now = Math.floor(Date.now() / 1000);
  const payload = { ...claims, iss: issuer, iat: now, exp: now + 60 };
  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: "ES256", kid: "surge-key", typ: "at+jwt" }).sign(privateKey);
  let result: Record<string, unknown> = { ...payload, active: true, token_type: "Bearer" };
  t.mock.method(globalThis, "fetch", async (input: URL | string, init?: RequestInit) => {
    const url = new URL(input);
    assert.equal(url.origin, issuer);
    if (url.pathname === "/.well-known/oauth-authorization-server") return Response.json(metadata(issuer));
    assert.equal(url.pathname, "/oauth2/introspect");
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init.headers).get("Authorization"), "Bearer surge-service-token");
    assert.equal(new URLSearchParams(String(init.body)).get("token"), token);
    return Response.json(result);
  });

  assert.deepEqual(await authorizeMcpOAuth(request(token), config), { subject, scopes: new Set(["mcp:read"]) });
  for (const changes of [{ active: false }, { aud: [resource] }, { client_id: "different" }, { exp: now }]) {
    result = { ...payload, active: true, token_type: "Bearer", ...changes };
    status(await authorizeMcpOAuth(request(token), config), 401);
  }
});
