import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { exportJWK, generateKeyPair, jwtVerify, SignJWT } from "jose";
import { NextRequest } from "next/server";
import {
  beginBrowserLogin,
  browserAuthEnabled,
  completeBrowserLogin,
  endBrowserSession,
} from "../src/server/browser-auth";

const origin = "https://viewer.example.test";
const issuer = "https://surge.example.test";
const clientId = "tsumiki-viewer";
const resource = `${origin}/api/mcp`;
const callback = `${origin}/auth/callback`;
const identity = "c2f93d23-1b85-4aab-b9dc-9a8a6b8197e5";
const sessionKey = new Uint8Array(32).fill(7);
const flowCookie = "__Host-tsumiki_oauth_flow";
const sessionCookie = "__Host-tsumiki_session";

test("browser OAuth signs in only after state, PKCE and ID token validation", async (t) => {
  const env = {
    TSUMIKI_BASE_URL: origin,
    TSUMIKI_OAUTH_ISSUER: issuer,
    TSUMIKI_OAUTH_RESOURCE: resource,
    TSUMIKI_OAUTH_CLIENT_ID: clientId,
    TSUMIKI_OAUTH_CLIENT_SECRET: "browser-secret",
    TSUMIKI_SESSION_SECRET: Buffer.from(sessionKey).toString("hex"),
  };
  const previous = { ...process.env };
  const oauthKeys = [
    ...Object.keys(env),
    "TSUMIKI_OAUTH_MCP_CLIENT_ID",
    "TSUMIKI_OAUTH_INTROSPECTION_TOKEN",
  ];
  t.after(() => {
    for (const key of oauthKeys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  for (const key of oauthKeys) delete process.env[key];

  const login = new NextRequest(`${origin}/auth/login?returnTo=%2Fcastle%3Fversion%3D2`);
  assert.equal(browserAuthEnabled(), false);
  assert.equal((await beginBrowserLogin(login)).headers.get("location"), "/auth/error?reason=disabled");
  process.env.TSUMIKI_OAUTH_ISSUER = "";
  assert.equal(browserAuthEnabled(), true);
  assert.equal((await beginBrowserLogin(login)).headers.get("location"), "/auth/error?reason=unavailable");
  Object.assign(process.env, env);

  const { privateKey, publicKey } = await generateKeyPair("ES256");
  const jwk = { ...await exportJWK(publicKey), kid: "key-1" };
  let token = "";
  let exchange: URLSearchParams | undefined;
  t.mock.method(globalThis, "fetch", async (input: URL | string, init?: RequestInit) => {
    switch (String(input)) {
      case `${issuer}/.well-known/oauth-authorization-server`:
        return Response.json({
          issuer,
          authorization_endpoint: `${issuer}/oauth2/authorize`,
          token_endpoint: `${issuer}/oauth2/token`,
          jwks_uri: `${issuer}/oauth2/jwks.json`,
        });
      case `${issuer}/oauth2/token`:
        assert.equal(init?.method, "POST");
        exchange = init.body as URLSearchParams;
        return Response.json({ id_token: token });
      case `${issuer}/oauth2/jwks.json`:
        return Response.json({ keys: [jwk] });
      default:
        assert.fail(`Unexpected fetch to ${input}`);
    }
  });

  const started = await beginBrowserLogin(login);
  assert.equal(started.status, 303);
  const authorize = new URL(started.headers.get("location")!);
  assert.equal(`${authorize.origin}${authorize.pathname}`, `${issuer}/oauth2/authorize`);
  assert.equal(authorize.searchParams.get("client_id"), clientId);
  assert.equal(authorize.searchParams.get("redirect_uri"), callback);
  assert.equal(authorize.searchParams.get("resource"), resource);
  assert.equal(authorize.searchParams.get("scope"), "openid");
  assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
  const nonce = authorize.searchParams.get("nonce")!;
  const state = authorize.searchParams.get("state")!;
  const flow = started.cookies.get(flowCookie)!;
  assert.ok(flow.httpOnly && flow.secure);
  assert.equal(flow.sameSite, "lax");
  assert.equal(flow.path, "/");

  function callbackRequest(value: string) {
    return new NextRequest(`${callback}?code=authorization-code&state=${value}`, {
      headers: { cookie: `${flowCookie}=${flow.value}` },
    });
  }

  assert.equal(
    (await completeBrowserLogin(callbackRequest("unexpected-state"))).headers.get("location"),
    "/auth/error?reason=invalid_flow",
  );
  for (const [query, reason] of [
    [`error=invalid_target&error_description=private-provider-details&state=${state}`, "invalid_target"],
    [`error=access_denied&state=${state}`, "access_denied"],
    [`error=temporarily_unavailable&state=${state}`, "unavailable"],
    [`error=unknown-provider-code&state=${state}`, "failed"],
    ["error=invalid_target&state=unexpected-state", "invalid_flow"],
    [`error=invalid_target&code=unexpected-code&state=${state}`, "invalid_flow"],
  ]) {
    const rejected = await completeBrowserLogin(new NextRequest(`${callback}?${query}`, {
      headers: { cookie: `${flowCookie}=${flow.value}` },
    }));
    assert.equal(rejected.status, 303);
    assert.equal(rejected.headers.get("location"), `/auth/error?reason=${reason}`);
    assert.equal(rejected.headers.get("cache-control"), "no-store");
    assert.equal(rejected.headers.get("referrer-policy"), "no-referrer");
    assert.equal(rejected.cookies.get(flowCookie)?.maxAge, 0);
    assert.equal(rejected.cookies.get(sessionCookie), undefined);
  }
  assert.equal(exchange, undefined);

  function issueIdentity(audience: string, tokenNonce: string, type = "JWT", subject = identity.toUpperCase()) {
    return new SignJWT({ nonce: tokenNonce })
      .setProtectedHeader({ alg: "ES256", kid: "key-1", typ: type })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject(subject)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
  }

  for (const invalidToken of [
    await issueIdentity(clientId, "incorrect-nonce"),
    await issueIdentity("other-client", nonce),
    await issueIdentity(clientId, nonce, "at+jwt"),
    await issueIdentity(clientId, nonce, "JWT", "../malformed-subject"),
  ]) {
    token = invalidToken;
    const rejected = await completeBrowserLogin(callbackRequest(state));
    assert.equal(rejected.headers.get("location"), "/auth/error?reason=failed");
    assert.equal(rejected.cookies.get(sessionCookie), undefined);
  }

  token = await issueIdentity(clientId, nonce);
  const signedIn = await completeBrowserLogin(callbackRequest(state));
  assert.equal(signedIn.status, 303);
  assert.equal(signedIn.headers.get("location"), `${origin}/castle?version=2`);
  assert.equal(signedIn.headers.get("cache-control"), "no-store");
  assert.equal(signedIn.cookies.get(flowCookie)?.maxAge, 0);
  assert.ok(exchange);
  const posted = exchange as URLSearchParams;
  assert.equal(posted.get("client_secret"), "browser-secret");
  assert.equal(posted.get("code"), "authorization-code");
  const challenge = createHash("sha256").update(posted.get("code_verifier")!).digest("base64url");
  assert.equal(challenge, authorize.searchParams.get("code_challenge"));
  const session = signedIn.cookies.get(sessionCookie)!;
  const verified = await jwtVerify(session.value, sessionKey, {
    issuer, audience: callback, typ: "tsumiki-session+jwt",
  });
  assert.equal(verified.payload.sub, identity);
  assert.ok(session.httpOnly && session.secure);
  assert.equal(session.sameSite, "lax");

  function logout(requestOrigin: string) {
    return endBrowserSession(new NextRequest(`${origin}/auth/logout`, {
      method: "POST",
      headers: { origin: requestOrigin },
    }));
  }
  assert.equal(logout(issuer).status, 403);
  const signedOut = logout(origin);
  assert.equal(signedOut.headers.get("location"), `${origin}/auth/signed-out`);
  assert.equal(signedOut.cookies.get(sessionCookie)?.maxAge, 0);
  assert.equal(signedOut.cookies.get(flowCookie)?.maxAge, 0);

  for (const target of ["//outside.example", "/\\outside.example", "/a/..//outside.example"]) {
    const request = new NextRequest(`${origin}/auth/login?returnTo=${encodeURIComponent(target)}`);
    const response = await beginBrowserLogin(request);
    const flow = response.cookies.get(flowCookie)!;
    const { payload } = await jwtVerify(flow.value, sessionKey);
    assert.equal(payload.returnTo, "/");
  }
});
